package us.gamewire.app;

import android.content.Context;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.work.*;

public class OfflineRefreshWorker extends Worker {
    public OfflineRefreshWorker(@NonNull Context context, @NonNull WorkerParameters parameters) { super(context, parameters); }
    @NonNull @Override public Result doWork() {
        try {
            org.json.JSONObject status = OfflineStore.get(getApplicationContext()).refresh(this::isStopped);
            return status.has("error") ? Result.retry() : Result.success();
        } catch (Exception error) {
            Log.e("GameWireOffline", "Background refresh failed", error);
            return Result.retry();
        }
    }
}
