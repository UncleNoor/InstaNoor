package com.unclenoor.instanoor;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/** Settings, usage time and follower snapshots, stored on the device. */
final class Store {
    private final SharedPreferences prefs;
    private final File snapshotDir;

    Store(Context context) {
        prefs = context.getSharedPreferences("instanoor", Context.MODE_PRIVATE);
        snapshotDir = new File(context.getFilesDir(), "follow-snapshots");
        if (!prefs.contains("customerId")) {
            prefs.edit().putString("customerId", UUID.randomUUID().toString()).apply();
        }
    }

    /** Settings as saved by the JS side, which normalizes them. May be empty on first run. */
    JSONObject settings() {
        try {
            return new JSONObject(prefs.getString("settings", "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    void saveSettings(JSONObject settings) {
        prefs.edit().putString("settings", settings.toString()).apply();
    }

    String customerId() {
        return prefs.getString("customerId", "");
    }

    static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    JSONObject usage() {
        try {
            return new JSONObject(prefs.getString("usage", "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    /** Adds seconds to today's total and returns the new total. */
    long addUsage(long seconds) {
        JSONObject usage = usage();
        String day = today();
        long total = usage.optLong(day, 0) + seconds;
        try {
            usage.put(day, total);
            // Keep about three months of history.
            List<String> days = new ArrayList<>();
            for (Iterator<String> it = usage.keys(); it.hasNext(); ) days.add(it.next());
            Collections.sort(days);
            while (days.size() > 90) usage.remove(days.remove(0));
        } catch (JSONException ignored) {
            // Keys are plain strings; put() cannot fail here.
        }
        prefs.edit().putString("usage", usage.toString()).apply();
        return total;
    }

    long usageToday() {
        return usage().optLong(today(), 0);
    }

    private File snapshotFile(String userId) {
        return new File(snapshotDir, userId.replaceAll("\\D", "") + ".json");
    }

    JSONObject readSnapshot(String userId) {
        File f = snapshotFile(userId);
        if (!f.exists()) return null;
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] data = new byte[(int) f.length()];
            int off = 0;
            while (off < data.length) {
                int n = in.read(data, off, data.length - off);
                if (n < 0) break;
                off += n;
            }
            return new JSONObject(new String(data, 0, off, StandardCharsets.UTF_8));
        } catch (IOException | JSONException e) {
            return null;
        }
    }

    void writeSnapshot(String userId, JSONObject snapshot) throws IOException {
        if (!snapshotDir.exists() && !snapshotDir.mkdirs()) throw new IOException("Cannot create " + snapshotDir);
        File tmp = new File(snapshotDir, "tmp.json");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(snapshot.toString().getBytes(StandardCharsets.UTF_8));
        }
        if (!tmp.renameTo(snapshotFile(userId))) throw new IOException("Cannot save snapshot");
    }
}
