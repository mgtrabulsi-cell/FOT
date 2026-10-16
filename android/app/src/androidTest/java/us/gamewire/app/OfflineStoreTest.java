package us.gamewire.app;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class OfflineStoreTest {
    private OfflineStore store;
    private File root;
    private String hash(String value) throws Exception {
        StringBuilder result = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))) result.append(String.format("%02x", b & 255));
        return result.toString();
    }
    @Before public void setup() throws Exception {
        Context original = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context fixture = new ContextWrapper(original) {
            @Override public File getNoBackupFilesDir() { return new File(super.getNoBackupFilesDir(), "isolated-offline-test"); }
            @Override public SharedPreferences getSharedPreferences(String name, int mode) { return super.getSharedPreferences("test-" + name, mode); }
        };
        store = new OfflineStore(fixture);
        store.clear();
        store.configure("https://fixture.supabase.co");
        root = new File(fixture.getNoBackupFilesDir(), "gamewire-public");
        assertTrue(root.exists() || root.mkdirs());
    }
    @After public void cleanup() throws Exception { store.clear(); }
    @Test public void cachedFaceUsesSharedLocalFileAndDeletionClearsIt() throws Exception {
        String url = "https://a.espncdn.com/fixture.png";
        File image = new File(root, hash(url) + ".png");
        try (FileOutputStream output = new FileOutputStream(image)) { output.write(new byte[] { 1, 2, 3 }); }
        assertEquals(image.getAbsolutePath(), store.image(url, 1));
        store.clear();
        assertFalse(image.exists());
        assertFalse(store.status().getBoolean("enabled"));
    }
    @Test public void failedDownloadPreservesLastGoodStatsAndTimestamp() throws Exception {
        String url = "https://site.api.espn.com:1/fixture";
        JSONObject record = new JSONObject().put("url", url).put("body", "{\"yards\":317}")
            .put("savedAt", "2026-10-16T19:00:00Z").put("accept", "").put("filter", "");
        File file = new File(root, hash(url + "\n\n") + ".json");
        try (FileOutputStream output = new FileOutputStream(file)) { output.write(record.toString().getBytes(StandardCharsets.UTF_8)); }
        JSONObject result = store.read(url, "", "", "", true, 1);
        assertEquals("{\"yards\":317}", result.getString("body"));
        assertEquals("2026-10-16T19:00:00Z", result.getString("savedAt"));
        assertTrue(file.exists());
        assertEquals(1, store.status().getInt("failures"));
    }
    @Test public void privateSourcesAreRejectedBeforeAnyNetworkRequest() throws Exception {
        for (String url : new String[] { "https://fixture.supabase.co/auth/v1/token", "https://fixture.supabase.co/rest/v1/user_favorites", "http://site.api.espn.com/fixture" }) {
            try { store.read(url, "", "", "", true, 1); fail("Private source was accepted"); }
            catch (java.io.IOException expected) { assertTrue(expected.getMessage().contains("public")); }
        }
        assertEquals(0, store.status().getInt("failures"));
    }
}
