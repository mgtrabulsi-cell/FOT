package us.gamewire.app;

import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import androidx.work.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Executors;
import java.util.concurrent.Executor;

@CapacitorPlugin(name = "GameWireOffline")
public class GameWireOfflinePlugin extends Plugin {
    private static final String TASK = "gamewire-public-refresh";
    private static final Executor DISK_READS = Executors.newSingleThreadExecutor();
    private void run(PluginCall call, Operation operation) {
        run(call, operation, OfflineStore.executor);
    }
    private void run(PluginCall call, Operation operation, Executor executor) {
        executor.execute(() -> {
            try { call.resolve(operation.run(OfflineStore.get(getContext()))); }
            catch (Exception error) { call.reject("Offline operation failed: " + error.getMessage(), error); }
        });
    }
    private interface Operation { JSObject run(OfflineStore store) throws Exception; }
    @PluginMethod public void configure(PluginCall call) {
        run(call, store -> {
            store.configure(call.getString("publicOrigin", ""));
            Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).setRequiresBatteryNotLow(true).build();
            PeriodicWorkRequest work = new PeriodicWorkRequest.Builder(OfflineRefreshWorker.class, 30, TimeUnit.MINUTES)
                .setInitialDelay(30, TimeUnit.MINUTES).setConstraints(constraints).build();
            WorkManager.getInstance(getContext()).enqueueUniquePeriodicWork(TASK, ExistingPeriodicWorkPolicy.KEEP, work).getResult().get();
            return new JSObject();
        });
    }
    @PluginMethod public void read(PluginCall call) {
        run(call, store -> JSObject.fromJSONObject(store.read(call.getString("url", ""), call.getString("accept", ""), call.getString("filter", ""), call.getString("apiKey", ""), true, 10000)));
    }
    @PluginMethod public void peek(PluginCall call) {
        run(call, store -> JSObject.fromJSONObject(store.peek(call.getString("url", ""), call.getString("accept", ""), call.getString("filter", ""))), DISK_READS);
    }
    @PluginMethod public void image(PluginCall call) {
        run(call, store -> new JSObject().put("path", store.image(call.getString("url", ""), 10000)));
    }
    @PluginMethod public void status(PluginCall call) { run(call, store -> JSObject.fromJSONObject(store.status())); }
    @PluginMethod public void clear(PluginCall call) {
        run(call, store -> {
            WorkManager.getInstance(getContext()).cancelUniqueWork(TASK).getResult().get();
            store.clear();
            return new JSObject();
        });
    }
}
