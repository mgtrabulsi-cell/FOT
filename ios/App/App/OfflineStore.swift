import Foundation
import Capacitor
import CryptoKit
import BackgroundTasks

final class OfflineCancellation {
    private let lock = NSLock()
    private var stopped = false
    func cancel() { lock.lock(); stopped = true; lock.unlock() }
    var cancelled: Bool { lock.lock(); defer { lock.unlock() }; return stopped }
}

final class OfflineStore {
    static let shared = OfflineStore()
    static let taskID = "us.gamewire.app.public-refresh"
    private let lock = NSRecursiveLock()
    private let settings = UserDefaults.standard
    private let root: URL
    private var generation = 0
    private var failures = 0
    private var taskRegistered = false
    private let espn = Set(["site.api.espn.com", "site.web.api.espn.com", "sports.core.api.espn.com", "lm-api-reads.fantasy.espn.com"])
    let queue = DispatchQueue(label: "us.gamewire.offline", attributes: .concurrent)

    private init() {
        root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("gamewire-public", isDirectory: true)
    }
    private func locked<T>(_ action: () throws -> T) rethrows -> T {
        lock.lock(); defer { lock.unlock() }; return try action()
    }
    private func error(_ message: String) -> NSError {
        NSError(domain: "GameWireOffline", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    private func origin(_ url: URL) -> String {
        guard let host = url.host else { return "" }
        return "https://\(host)" + (url.port.map { ":\($0)" } ?? "")
    }
    func configure(_ publicOrigin: String) throws {
        if !publicOrigin.isEmpty {
            guard let url = URL(string: publicOrigin), url.scheme == "https", url.user == nil, url.password == nil, origin(url) == publicOrigin else { throw error("Invalid public API origin") }
        }
        settings.set(publicOrigin, forKey: "gamewire-public-origin")
        settings.set(true, forKey: "gamewire-refresh-enabled")
        guard taskRegistered else {
            settings.set(false, forKey: "gamewire-refresh-enabled")
            settings.set(["error": "Background task registration failed. Foreground offline saving remains available; contact support."], forKey: "gamewire-refresh-status")
            return
        }
        do { try schedule() }
        catch {
            NSLog("GameWire background refresh could not be scheduled: %@", error.localizedDescription)
            settings.set(false, forKey: "gamewire-refresh-enabled")
            settings.set(["error": "Background refresh is unavailable. Check iPhone Background App Refresh settings; foreground offline saving remains available."], forKey: "gamewire-refresh-status")
        }
    }
    private func validate(_ address: String, image: Bool) throws -> URL {
        guard let url = URL(string: address), url.scheme == "https", url.user == nil, url.password == nil else { throw error("Invalid public URL") }
        let publicAPI = !origin(url).isEmpty && origin(url) == settings.string(forKey: "gamewire-public-origin")
        let allowed = image
            ? url.host == "a.espncdn.com" || (publicAPI && url.path.hasPrefix("/storage/v1/object/public/livewire-photos/"))
            : espn.contains(url.host ?? "") || (publicAPI && ["/rest/v1/livewire_posts", "/rest/v1/matchup_boards"].contains(url.path))
        guard allowed else { throw error("Only public sports data can be saved") }
        return url
    }
    private func file(_ key: String, image: Bool = false) -> URL {
        let hash = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return root.appendingPathComponent(hash + (image ? ".png" : ".json"))
    }
    private func load(_ url: URL) throws -> [String: Any]? {
        try locked {
            guard FileManager.default.fileExists(atPath: url.path) else { return nil }
            guard let value = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any] else { throw error("Invalid saved public response") }
            return value
        }
    }
    private func save(_ url: URL, data: Data, epoch: Int) throws {
        try locked {
            guard epoch == generation else { throw error("Offline copy was cleared") }
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            var directory = root
            var resource = URLResourceValues()
            resource.isExcludedFromBackup = true
            try directory.setResourceValues(resource)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            let files = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey])
            let entries = try files.map { file -> (URL, Date, Int) in
                let info = try file.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
                return (file, info.contentModificationDate ?? .distantPast, info.fileSize ?? 0)
            }.sorted { $0.1 < $1.1 }
            var bytes = entries.reduce(0) { $0 + $1.2 }
            var count = entries.count
            for entry in entries where bytes > 512 * 1024 * 1024 || count > 4000 {
                if entry.0 == url { continue }
                try FileManager.default.removeItem(at: entry.0)
                failures += 1
                NSLog("GameWire offline storage limit reached; older content was evicted")
                bytes -= entry.2; count -= 1
            }
        }
    }
    private func download(_ url: URL, headers: [String: String], timeout: TimeInterval) throws -> Data {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.allHTTPHeaderFields = headers
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        let session = URLSession(configuration: configuration, delegate: NoRedirectDelegate(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let semaphore = DispatchSemaphore(value: 0)
        let result = DownloadResult()
        let task = session.dataTask(with: request) { data, response, cause in
            defer { semaphore.signal() }
            if let cause = cause { result.value = .failure(cause); return }
            guard let response = response as? HTTPURLResponse, response.statusCode == 200,
                  response.url == url, let data = data, data.count <= 5 * 1024 * 1024 else {
                result.value = .failure(self.error("Public download failed or exceeded its size limit")); return
            }
            result.value = .success(data)
        }
        task.resume()
        guard semaphore.wait(timeout: .now() + timeout + 0.5) == .success else { task.cancel(); throw error("Public download timed out") }
        guard let value = result.value else { throw error("Missing public download result") }
        return try value.get()
    }
    func peek(_ address: String, accept: String, filter: String) throws -> [String: Any] {
        _ = try validate(address, image: false)
        guard let record = try load(file(address + "\n" + accept + "\n" + filter)),
              let body = record["body"], let savedAt = record["savedAt"] else { return [:] }
        return ["body": body, "savedAt": savedAt]
    }
    func read(_ address: String, accept: String, filter: String, apiKey: String, fallback: Bool = true, timeout: TimeInterval = 10) throws -> [String: Any] {
        let url = try validate(address, image: false)
        let epoch = locked { generation }
        let path = file(address + "\n" + accept + "\n" + filter)
        let previous = try load(path)
        do {
            var headers: [String: String] = [:]
            if !accept.isEmpty { headers["accept"] = accept }
            if !filter.isEmpty { headers["x-fantasy-filter"] = filter }
            let key = origin(url) == settings.string(forKey: "gamewire-public-origin") ? apiKey : ""
            if !key.isEmpty { headers["apikey"] = key }
            let data = try download(url, headers: headers, timeout: timeout)
            _ = try JSONSerialization.jsonObject(with: data)
            guard let body = String(data: data, encoding: .utf8) else { throw error("Invalid public text response") }
            let record: [String: Any] = ["url": address, "accept": accept, "filter": filter, "apiKey": key, "body": body, "savedAt": ISO8601DateFormatter().string(from: Date())]
            try save(path, data: JSONSerialization.data(withJSONObject: record), epoch: epoch)
            return ["body": body]
        } catch {
            locked { failures += 1 }
            NSLog("GameWire public read failed: %@", error.localizedDescription)
            if fallback, let previous = previous, let body = previous["body"], let savedAt = previous["savedAt"] { return ["body": body, "savedAt": savedAt] }
            throw error
        }
    }
    func image(_ address: String, timeout: TimeInterval = 10) throws -> String {
        let url = try validate(address, image: true)
        let epoch = locked { generation }
        let path = file(address, image: true)
        if FileManager.default.fileExists(atPath: path.path) { return path.absoluteString }
        try save(path, data: download(url, headers: [:], timeout: timeout), epoch: epoch)
        return path.absoluteString
    }
    private func images(_ value: Any, into result: inout Set<String>) {
        if let value = value as? String, value.hasPrefix("https://a.espncdn.com/"),
           let url = URL(string: value), ["png", "jpg", "jpeg", "webp"].contains(url.pathExtension.lowercased()) { result.insert(value) }
        else if let array = value as? [Any] { for item in array { images(item, into: &result) } }
        else if let object = value as? [String: Any] { for item in object.values { images(item, into: &result) } }
    }
    func refresh(_ cancellation: OfflineCancellation) throws -> Bool {
        guard settings.bool(forKey: "gamewire-refresh-enabled") else { return true }
        let baseline = locked { failures }
        let deadline = Date().addingTimeInterval(24)
        let scoreboard = file("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard\n\n")
        let files = try locked { () -> [URL] in
            guard FileManager.default.fileExists(atPath: root.path) else { return [] }
            return try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey])
                .filter { $0.pathExtension == "json" }
                .sorted {
                    if ($0 == scoreboard) != ($1 == scoreboard) { return $0 == scoreboard }
                    return (try $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate ?? .distantPast) < (try $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate ?? .distantPast)
                }
        }
        var refreshed = 0, errors = 0, attempted = 0
        var pictures = Set<String>()
        for path in files {
            if cancellation.cancelled || Date() > deadline.addingTimeInterval(-6) || attempted >= 48 { break }
            attempted += 1
            do {
                guard let record = try load(path), let address = record["url"] as? String else { throw error("Invalid saved request") }
                let result = try read(address, accept: record["accept"] as? String ?? "", filter: record["filter"] as? String ?? "", apiKey: record["apiKey"] as? String ?? "", fallback: false, timeout: 4)
                if let body = result["body"] as? String { images(try JSONSerialization.jsonObject(with: Data(body.utf8)), into: &pictures) }
                refreshed += 1
            } catch { errors += 1; NSLog("GameWire background data failed: %@", error.localizedDescription) }
        }
        var picturesSaved = 0
        for address in pictures {
            if cancellation.cancelled || Date() > deadline.addingTimeInterval(-4) { break }
            do { _ = try image(address, timeout: 2); picturesSaved += 1 }
            catch { errors += 1; NSLog("GameWire background image failed: %@", error.localizedDescription) }
        }
        let remaining = files.count - refreshed + pictures.count - picturesSaved
        let complete = errors == 0 && remaining == 0 && locked({ failures }) == baseline && !cancellation.cancelled
        var status: [String: Any] = ["enabled": true, "lastAttempt": ISO8601DateFormatter().string(from: Date()), "refreshed": refreshed, "remaining": remaining]
        if complete { status["lastSuccess"] = ISO8601DateFormatter().string(from: Date()) }
        else { status["error"] = "Background copy is partial. Open online to finish saving; existing copies remain available." }
        settings.set(status, forKey: "gamewire-refresh-status")
        return complete
    }
    func status() -> [String: Any] {
        locked {
            var result = settings.dictionary(forKey: "gamewire-refresh-status") ?? [:]
            result["enabled"] = settings.bool(forKey: "gamewire-refresh-enabled")
            result["failures"] = failures
            return result
        }
    }
    func clear() throws {
        try locked {
            generation += 1
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.taskID)
            for key in ["gamewire-public-origin", "gamewire-refresh-enabled", "gamewire-refresh-status"] { settings.removeObject(forKey: key) }
            if FileManager.default.fileExists(atPath: root.path) {
                for file in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) { try FileManager.default.removeItem(at: file) }
            }
        }
    }
    func schedule() throws {
        guard settings.bool(forKey: "gamewire-refresh-enabled") else { return }
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.taskID)
        let request = BGAppRefreshTaskRequest(identifier: Self.taskID)
        request.earliestBeginDate = Date().addingTimeInterval(30 * 60)
        try BGTaskScheduler.shared.submit(request)
    }
    func register() {
        let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.taskID, using: nil) { task in
            let cancellation = OfflineCancellation()
            let completion = BackgroundCompletion(task)
            task.expirationHandler = { cancellation.cancel(); completion.finish(false) }
            self.queue.async {
                do {
                    let success = try self.refresh(cancellation)
                    completion.finish(success)
                } catch { NSLog("GameWire background refresh failed: %@", error.localizedDescription); completion.finish(false) }
                do { try self.schedule() }
                catch { NSLog("GameWire background scheduling failed: %@", error.localizedDescription) }
            }
            taskRegistered = registered
        }
        if !registered { NSLog("GameWire background task registration failed") }
    }
}

private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private final class DownloadResult {
    private let lock = NSLock()
    private var stored: Result<Data, Error>?
    var value: Result<Data, Error>? {
        get { lock.lock(); defer { lock.unlock() }; return stored }
        set { lock.lock(); stored = newValue; lock.unlock() }
    }
}

private final class BackgroundCompletion {
    private let lock = NSLock()
    private var finished = false
    private let task: BGTask
    init(_ task: BGTask) { self.task = task }
    func finish(_ success: Bool) {
        lock.lock(); defer { lock.unlock() }
        guard !finished else { return }
        finished = true
        task.setTaskCompleted(success: success)
    }
}

@objc(GameWireOfflinePlugin)
public class GameWireOfflinePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GameWireOfflinePlugin"
    public let jsName = "GameWireOffline"
    public let pluginMethods: [CAPPluginMethod] = ["configure", "read", "peek", "image", "status", "clear"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private let diskReads = DispatchQueue(label: "us.gamewire.offline.disk")
    private func run(_ call: CAPPluginCall, diskOnly: Bool = false, action: @escaping () throws -> [String: Any]) {
        let queue = diskOnly ? diskReads : OfflineStore.shared.queue
        queue.async {
            do { call.resolve(try action()) }
            catch { call.reject("Offline operation failed: \(error.localizedDescription)", nil, error) }
        }
    }
    @objc func configure(_ call: CAPPluginCall) {
        run(call) { try OfflineStore.shared.configure(call.getString("publicOrigin") ?? ""); return [:] }
    }
    @objc func read(_ call: CAPPluginCall) {
        run(call) { try OfflineStore.shared.read(call.getString("url") ?? "", accept: call.getString("accept") ?? "", filter: call.getString("filter") ?? "", apiKey: call.getString("apiKey") ?? "") }
    }
    @objc func peek(_ call: CAPPluginCall) {
        run(call, diskOnly: true) { try OfflineStore.shared.peek(call.getString("url") ?? "", accept: call.getString("accept") ?? "", filter: call.getString("filter") ?? "") }
    }
    @objc func image(_ call: CAPPluginCall) {
        run(call) { ["path": try OfflineStore.shared.image(call.getString("url") ?? "")] }
    }
    @objc func status(_ call: CAPPluginCall) { run(call) { OfflineStore.shared.status() } }
    @objc func clear(_ call: CAPPluginCall) { run(call) { try OfflineStore.shared.clear(); return [:] } }
}

class GameWireViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(GameWireOfflinePlugin()) }
}
