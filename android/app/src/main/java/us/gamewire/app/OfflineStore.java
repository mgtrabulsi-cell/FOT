package us.gamewire.app;

import android.content.Context;
import android.util.AtomicFile;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

final class OfflineStore {
    static final ExecutorService executor = Executors.newFixedThreadPool(4);
    private static OfflineStore instance;
    static synchronized OfflineStore get(Context context) {
        if (instance == null) instance = new OfflineStore(context.getApplicationContext());
        return instance;
    }
    private final File root;
    private final android.content.SharedPreferences settings;
    private int generation = 0;
    private int failures = 0;
    private static final Set<String> ESPN = new HashSet<>(Arrays.asList(
        "site.api.espn.com", "site.web.api.espn.com", "sports.core.api.espn.com", "lm-api-reads.fantasy.espn.com"));
    private static String now() {
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(new Date());
    }

    OfflineStore(Context context) {
        root = new File(context.getNoBackupFilesDir(), "gamewire-public");
        settings = context.getSharedPreferences("gamewire-background", Context.MODE_PRIVATE);
    }
    synchronized void configure(String origin) throws Exception {
        if (!origin.isEmpty()) {
            URL url = new URL(origin);
            if (!url.getProtocol().equals("https") || url.getUserInfo() != null || !origin.equals("https://" + url.getAuthority())) {
                throw new IOException("Invalid public API origin");
            }
        }
        settings.edit().putString("origin", origin).putBoolean("enabled", true).apply();
    }
    private boolean samePublicOrigin(URL url) {
        return ("https://" + url.getAuthority()).equals(settings.getString("origin", ""));
    }
    private void validate(String address, boolean image) throws Exception {
        URL url = new URL(address);
        boolean allowed = image
            ? url.getHost().equals("a.espncdn.com") || (samePublicOrigin(url) && url.getPath().startsWith("/storage/v1/object/public/livewire-photos/"))
            : ESPN.contains(url.getHost()) || (samePublicOrigin(url) && url.getPath().matches("/rest/v1/(livewire_posts|matchup_boards)"));
        if (!url.getProtocol().equals("https") || url.getUserInfo() != null || !allowed) throw new IOException("Only public sports data can be saved");
    }
    private String hash(String value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder text = new StringBuilder();
        for (byte b : bytes) text.append(String.format("%02x", b & 255));
        return text.toString();
    }
    private synchronized JSONObject load(File file) throws Exception {
        if (!file.exists()) return null;
        try (InputStream stream = new AtomicFile(file).openRead(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int length;
            while ((length = stream.read(buffer)) != -1) bytes.write(buffer, 0, length);
            return new JSONObject(bytes.toString("UTF-8"));
        }
    }
    private synchronized void save(File file, byte[] bytes, int epoch) throws Exception {
        if (epoch != generation) throw new IOException("Offline copy was cleared");
        if (!root.exists() && !root.mkdirs()) throw new IOException("Could not create offline storage");
        AtomicFile atomic = new AtomicFile(file);
        FileOutputStream stream = atomic.startWrite();
        try { stream.write(bytes); atomic.finishWrite(stream); }
        catch (Exception error) { atomic.failWrite(stream); throw error; }
        File[] files = root.listFiles((dir, name) -> name.endsWith(".json") || name.endsWith(".png"));
        if (files == null) throw new IOException("Could not inspect offline storage");
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        long size = 0;
        for (File entry : files) size += entry.length();
        int count = files.length;
        for (File entry : files) {
            if (size <= 512L * 1024 * 1024 && count <= 4000) break;
            if (entry.equals(file)) continue;
            long length = entry.length();
            if (!entry.delete()) throw new IOException("Could not prune offline storage");
            failures++;
            Log.w("GameWireOffline", "Offline storage limit reached; older content was evicted");
            size -= length;
            count--;
        }
    }
    private byte[] download(String address, Map<String, String> headers, int maximum, int timeout) throws Exception {
        HttpsURLConnection connection = (HttpsURLConnection) new URL(address).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(timeout);
        connection.setReadTimeout(timeout);
        headers.forEach(connection::setRequestProperty);
        try {
            if (connection.getResponseCode() != 200) throw new IOException("HTTP " + connection.getResponseCode());
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int length;
                while ((length = input.read(buffer)) != -1) {
                    if (bytes.size() + length > maximum) throw new IOException("Offline response is too large");
                    bytes.write(buffer, 0, length);
                }
                return bytes.toByteArray();
            }
        } finally { connection.disconnect(); }
    }
    JSONObject peek(String url, String accept, String filter) throws Exception {
        validate(url, false);
        JSONObject record = load(new File(root, hash(url + "\n" + accept + "\n" + filter) + ".json"));
        return record == null ? new JSONObject() : new JSONObject().put("body", record.getString("body")).put("savedAt", record.getString("savedAt"));
    }
    JSONObject read(String url, String accept, String filter, String apiKey, boolean fallback, int timeout) throws Exception {
        validate(url, false);
        int epoch;
        synchronized (this) { epoch = generation; }
        File file = new File(root, hash(url + "\n" + accept + "\n" + filter) + ".json");
        JSONObject previous = load(file);
        try {
            Map<String, String> headers = new HashMap<>();
            if (!accept.isEmpty()) headers.put("accept", accept);
            if (!filter.isEmpty()) headers.put("x-fantasy-filter", filter);
            if (samePublicOrigin(new URL(url)) && !apiKey.isEmpty()) headers.put("apikey", apiKey);
            String body = new String(download(url, headers, 5 * 1024 * 1024, timeout), StandardCharsets.UTF_8);
            Object payload = new org.json.JSONTokener(body).nextValue();
            if (!(payload instanceof JSONObject) && !(payload instanceof JSONArray)) throw new IOException("Invalid public JSON");
            JSONObject record = new JSONObject().put("url", url).put("accept", accept).put("filter", filter)
                .put("apiKey", samePublicOrigin(new URL(url)) ? apiKey : "").put("body", body).put("savedAt", now());
            save(file, record.toString().getBytes(StandardCharsets.UTF_8), epoch);
            return new JSONObject().put("body", body);
        } catch (Exception error) {
            synchronized (this) { failures++; }
            Log.w("GameWireOffline", "Public request failed; retaining last good copy", error);
            if (fallback && previous != null) return new JSONObject().put("body", previous.getString("body")).put("savedAt", previous.getString("savedAt"));
            throw error;
        }
    }
    String image(String url, int timeout) throws Exception {
        validate(url, true);
        int epoch;
        synchronized (this) { epoch = generation; }
        File file = new File(root, hash(url) + ".png");
        if (file.exists()) return file.getAbsolutePath();
        save(file, download(url, Collections.emptyMap(), 5 * 1024 * 1024, timeout), epoch);
        return file.getAbsolutePath();
    }
    private void images(Object value, Set<String> urls) throws Exception {
        if (value instanceof String && ((String) value).matches("https://a\\.espncdn\\.com/.*\\.(png|jpg|jpeg|webp)(\\?.*)?")) urls.add((String) value);
        else if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            for (int i = 0; i < array.length(); i++) images(array.get(i), urls);
        } else if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            for (Iterator<String> keys = object.keys(); keys.hasNext();) images(object.get(keys.next()), urls);
        }
    }
    JSONObject refresh(java.util.function.BooleanSupplier cancelled) throws Exception {
        if (!settings.getBoolean("enabled", false)) return status();
        int baseline = status().getInt("failures");
        long deadline = android.os.SystemClock.elapsedRealtime() + 24000;
        int refreshed = 0, errors = 0;
        File[] files = root.listFiles((dir, name) -> name.endsWith(".json"));
        if (files == null) files = new File[0];
        File scoreboard = new File(root, hash("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard\n\n") + ".json");
        Arrays.sort(files, Comparator.<File>comparingInt(file -> file.equals(scoreboard) ? 0 : 1).thenComparingLong(File::lastModified));
        LinkedHashSet<String> pictures = new LinkedHashSet<>();
        int attempted = 0;
        for (File file : files) {
            if (cancelled.getAsBoolean() || android.os.SystemClock.elapsedRealtime() > deadline - 6000 || attempted >= 48) break;
            JSONObject record = load(file);
            if (record == null) continue;
            attempted++;
            try {
                JSONObject result = read(record.getString("url"), record.optString("accept"), record.optString("filter"), record.optString("apiKey"), false, 4000);
                images(new org.json.JSONTokener(result.getString("body")).nextValue(), pictures);
                refreshed++;
            } catch (Exception error) { errors++; Log.w("GameWireOffline", "Background data refresh failed", error); }
        }
        int picturesSaved = 0;
        for (String url : pictures) {
            if (cancelled.getAsBoolean() || android.os.SystemClock.elapsedRealtime() > deadline - 4000) break;
            try { image(url, 2000); picturesSaved++; }
            catch (Exception error) { errors++; Log.w("GameWireOffline", "Background image save failed", error); }
        }
        int remaining = files.length - refreshed + pictures.size() - picturesSaved;
        JSONObject result = new JSONObject().put("enabled", true).put("lastAttempt", now())
            .put("refreshed", refreshed).put("remaining", remaining);
        if (errors > 0 || remaining > 0 || status().getInt("failures") != baseline || cancelled.getAsBoolean()) result.put("error", "Background copy is partial. Open online to finish saving; existing copies remain available.");
        else result.put("lastSuccess", now());
        settings.edit().putString("status", result.toString()).apply();
        return result;
    }
    synchronized JSONObject status() throws Exception {
        JSONObject result = new JSONObject(settings.getString("status", "{}"));
        return result.put("enabled", settings.getBoolean("enabled", false)).put("failures", failures);
    }
    synchronized void clear() throws Exception {
        generation++;
        settings.edit().clear().commit();
        File[] files = root.listFiles();
        if (files != null) for (File file : files) if (!file.delete()) throw new IOException("Could not clear saved public data");
    }
}
