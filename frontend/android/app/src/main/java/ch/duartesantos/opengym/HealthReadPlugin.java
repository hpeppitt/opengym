package ch.duartesantos.opengym;

import android.content.Intent;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.contract.ActivityResultContract;
import androidx.health.connect.client.HealthConnectClient;
import androidx.health.connect.client.PermissionController;
import androidx.health.connect.client.aggregate.AggregateMetric;
import androidx.health.connect.client.aggregate.AggregationResult;
import androidx.health.connect.client.aggregate.AggregationResultGroupedByPeriod;
import androidx.health.connect.client.records.ExerciseSessionRecord;
import androidx.health.connect.client.records.HeartRateRecord;
import androidx.health.connect.client.records.NutritionRecord;
import androidx.health.connect.client.records.Record;
import androidx.health.connect.client.records.RestingHeartRateRecord;
import androidx.health.connect.client.records.SleepSessionRecord;
import androidx.health.connect.client.records.StepsRecord;
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord;
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest;
import androidx.health.connect.client.request.AggregateRequest;
import androidx.health.connect.client.request.ReadRecordsRequest;
import androidx.health.connect.client.response.ReadRecordsResponse;
import androidx.health.connect.client.time.TimeRangeFilter;
import androidx.health.connect.client.units.Energy;
import androidx.health.connect.client.units.Mass;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.time.Instant;
import java.time.LocalDate;
import java.time.Period;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlin.jvm.JvmClassMappingKt;
import kotlinx.coroutines.BuildersKt;

/**
 * Reads health data back out of Health Connect for the fork's stats (OG-020). Upstream's
 * HealthConnectPlugin only writes; this is a separate class so the two never conflict in a
 * merge. Read-only, and asks for nothing until the user turns the stats on.
 *
 * Steps, calories burned and nutrition are read as Health Connect aggregates, one bucket per local
 * day: Health Connect deduplicates overlapping sources there (a Fitbit and the phone both counting
 * steps), where summing raw records double-counts. Sleep, resting heart rate and exercise sessions
 * are raw records, which lib/health-read.js shapes; each cardio session also carries its own peak
 * heart rate, aggregated over that session's time only (fit-app FIT-136: a raw heart-rate scan
 * over 30 days overflowed a page and lost samples).
 *
 * Same conventions as upstream's plugin: Kotlin suspend functions through runBlocking on one
 * worker thread, and "unsupported" below Android 9.
 *
 * Usage from JS (lib/health-read.js):
 *   const HR = registerPlugin('HealthRead');
 *   await HR.status();                       // { status, granted: { steps, calories, ... }, all }
 *   await HR.requestPermissions();           // same shape as status
 *   await HR.daily({ from, to });            // ISO dates, inclusive: { days: [{ date, steps, kcalBurned, kcalEaten, proteinG }] }
 *   await HR.sleep({ start, end });          // epoch ms: { sessions: [{ start, end, origin, stages: [{ stage, start, end }] }] }
 *   await HR.restingHeartRate({ start, end });  // { readings: [{ time, bpm, origin }] }
 *   await HR.exerciseSessions({ start, end });  // { sessions: [{ start, end, type, title, origin, maxHr }] }
 */
@CapacitorPlugin(name = "HealthRead")
public class HealthReadPlugin extends Plugin {

    private static final String PROVIDER = "com.google.android.apps.healthdata";
    // The literal permission names, as declared in AndroidManifest.xml.
    private static final String[][] PERMISSIONS = {
        { "steps", "android.permission.health.READ_STEPS" },
        { "calories", "android.permission.health.READ_TOTAL_CALORIES_BURNED" },
        { "nutrition", "android.permission.health.READ_NUTRITION" },
        { "sleep", "android.permission.health.READ_SLEEP" },
        { "restingHeartRate", "android.permission.health.READ_RESTING_HEART_RATE" },
        { "heartRate", "android.permission.health.READ_HEART_RATE" },
        { "exercise", "android.permission.health.READ_EXERCISE" },
    };
    private static final int PAGE = 1000;

    // Every worker body catches Throwable, not Exception: the client library signals some failures with
    // Kotlin's NotImplementedError, an Error, and one uncaught on this thread kills the whole app.
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private static boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P;
    }

    private static Set<String> permissions() {
        Set<String> p = new HashSet<>();
        for (String[] e : PERMISSIONS) p.add(e[1]);
        return p;
    }

    private String sdkStatus() {
        if (!supported()) return "unsupported";
        int s = HealthConnectClient.Companion.getSdkStatus(getContext(), PROVIDER);
        if (s == HealthConnectClient.SDK_AVAILABLE) return "available";
        if (s == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return "update";
        return Build.VERSION.SDK_INT >= 34 ? "unsupported" : "missing";
    }

    private HealthConnectClient client() {
        return HealthConnectClient.Companion.getOrCreate(getContext(), PROVIDER);
    }

    @SuppressWarnings("unchecked")
    private Set<String> granted() throws InterruptedException {
        PermissionController pc = client().getPermissionController();
        return (Set<String>) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> pc.getGrantedPermissions(cont));
    }

    // Which kinds of data may be read, one flag each: the user can grant some and not others.
    private static JSObject grantShape(String status, Set<String> got) {
        JSObject g = new JSObject();
        boolean all = true;
        for (String[] e : PERMISSIONS) {
            boolean has = got != null && got.contains(e[1]);
            g.put(e[0], has);
            all &= has;
        }
        JSObject r = new JSObject();
        r.put("status", status);
        r.put("granted", g);
        r.put("all", all);
        return r;
    }

    private boolean available(PluginCall call) {
        if ("available".equals(sdkStatus())) return true;
        call.reject("Health Connect is not available", "unavailable");
        return false;
    }

    @PluginMethod
    public void status(PluginCall call) {
        String status = sdkStatus();
        if (!"available".equals(status)) { call.resolve(grantShape(status, null)); return; }
        worker.execute(() -> {
            try { call.resolve(grantShape(status, granted())); }
            catch (Throwable e) { call.reject(e.getMessage(), "failed"); }
        });
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (!available(call)) return;
        ActivityResultContract<Set<String>, Set<String>> contract = PermissionController.createRequestPermissionResultContract(PROVIDER);
        Intent intent = contract.createIntent(getContext(), permissions());
        startActivityForResult(call, intent, "permissionsResult");
    }

    @ActivityCallback
    private void permissionsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        // The dialog answers for this time only; what stands now is Health Connect's to say.
        worker.execute(() -> {
            try { call.resolve(grantShape("available", granted())); }
            catch (Throwable e) { call.reject(e.getMessage(), "failed"); }
        });
    }

    /** Steps, calories burned, calories eaten and protein per local day, from..to inclusive. */
    @PluginMethod
    public void daily(PluginCall call) {
        if (!available(call)) return;
        String from = call.getString("from"), to = call.getString("to");
        if (from == null || to == null) { call.reject("from and to are required", "bad-request"); return; }
        worker.execute(() -> {
            try {
                Set<String> got = granted();
                Set<AggregateMetric<?>> metrics = new HashSet<>();
                if (got.contains(PERMISSIONS[0][1])) metrics.add(StepsRecord.COUNT_TOTAL);
                if (got.contains(PERMISSIONS[1][1])) metrics.add(TotalCaloriesBurnedRecord.ENERGY_TOTAL);
                if (got.contains(PERMISSIONS[2][1])) { metrics.add(NutritionRecord.ENERGY_TOTAL); metrics.add(NutritionRecord.PROTEIN_TOTAL); }
                JSArray days = new JSArray();
                if (!metrics.isEmpty()) {
                    LocalDate start = LocalDate.parse(from), end = LocalDate.parse(to).plusDays(1);
                    AggregateGroupByPeriodRequest req = new AggregateGroupByPeriodRequest(metrics,
                            TimeRangeFilter.between(start.atStartOfDay(), end.atStartOfDay()), Period.ofDays(1), Collections.emptySet());
                    @SuppressWarnings("unchecked")
                    List<AggregationResultGroupedByPeriod> buckets = (List<AggregationResultGroupedByPeriod>)
                            BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().aggregateGroupByPeriod(req, cont));
                    for (AggregationResultGroupedByPeriod b : buckets) {
                        AggregationResult r = b.getResult();
                        JSObject d = new JSObject();
                        d.put("date", b.getStartTime().toLocalDate().toString());
                        Long steps = r.get(StepsRecord.COUNT_TOTAL);
                        Energy burned = r.get(TotalCaloriesBurnedRecord.ENERGY_TOTAL);
                        Energy eaten = r.get(NutritionRecord.ENERGY_TOTAL);
                        Mass protein = r.get(NutritionRecord.PROTEIN_TOTAL);
                        d.put("steps", steps == null ? JSObject.NULL : steps);
                        d.put("kcalBurned", burned == null ? JSObject.NULL : burned.getKilocalories());
                        d.put("kcalEaten", eaten == null ? JSObject.NULL : eaten.getKilocalories());
                        d.put("proteinG", protein == null ? JSObject.NULL : protein.getGrams());
                        days.put(d);
                    }
                }
                JSObject out = new JSObject();
                out.put("days", days);
                call.resolve(out);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Throwable e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void sleep(PluginCall call) {
        if (!available(call)) return;
        Instant[] range = range(call);
        if (range == null) return;
        worker.execute(() -> {
            try {
                JSArray sessions = new JSArray();
                for (SleepSessionRecord s : readAll(SleepSessionRecord.class, range[0], range[1])) {
                    JSObject o = new JSObject();
                    o.put("start", s.getStartTime().toEpochMilli());
                    o.put("end", s.getEndTime().toEpochMilli());
                    o.put("origin", s.getMetadata().getDataOrigin().getPackageName());
                    JSArray stages = new JSArray();
                    for (SleepSessionRecord.Stage st : s.getStages()) {
                        JSObject x = new JSObject();
                        x.put("stage", st.getStage());
                        x.put("start", st.getStartTime().toEpochMilli());
                        x.put("end", st.getEndTime().toEpochMilli());
                        stages.put(x);
                    }
                    o.put("stages", stages);
                    sessions.put(o);
                }
                JSObject out = new JSObject();
                out.put("sessions", sessions);
                call.resolve(out);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Throwable e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void restingHeartRate(PluginCall call) {
        if (!available(call)) return;
        Instant[] range = range(call);
        if (range == null) return;
        worker.execute(() -> {
            try {
                JSArray readings = new JSArray();
                for (RestingHeartRateRecord r : readAll(RestingHeartRateRecord.class, range[0], range[1])) {
                    JSObject o = new JSObject();
                    o.put("time", r.getTime().toEpochMilli());
                    o.put("bpm", r.getBeatsPerMinute());
                    o.put("origin", r.getMetadata().getDataOrigin().getPackageName());
                    readings.put(o);
                }
                JSObject out = new JSObject();
                out.put("readings", readings);
                call.resolve(out);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Throwable e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    /** Exercise sessions, each with the peak heart rate inside its own time when that may be read. */
    @PluginMethod
    public void exerciseSessions(PluginCall call) {
        if (!available(call)) return;
        Instant[] range = range(call);
        if (range == null) return;
        worker.execute(() -> {
            try {
                boolean hr = granted().contains(PERMISSIONS[5][1]);
                JSArray sessions = new JSArray();
                for (ExerciseSessionRecord s : readAll(ExerciseSessionRecord.class, range[0], range[1])) {
                    JSObject o = new JSObject();
                    o.put("start", s.getStartTime().toEpochMilli());
                    o.put("end", s.getEndTime().toEpochMilli());
                    o.put("type", s.getExerciseType());
                    o.put("title", s.getTitle() == null ? JSObject.NULL : s.getTitle());
                    o.put("origin", s.getMetadata().getDataOrigin().getPackageName());
                    o.put("maxHr", hr ? peakHeartRate(s.getStartTime(), s.getEndTime()) : JSObject.NULL);
                    sessions.put(o);
                }
                JSObject out = new JSObject();
                out.put("sessions", sessions);
                call.resolve(out);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Throwable e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    private Object peakHeartRate(Instant start, Instant end) throws InterruptedException {
        Set<AggregateMetric<?>> metrics = new HashSet<>();
        metrics.add(HeartRateRecord.BPM_MAX);
        metrics.add(HeartRateRecord.MEASUREMENTS_COUNT);
        AggregateRequest req = new AggregateRequest(metrics, TimeRangeFilter.between(start, end), Collections.emptySet());
        AggregationResult r = (AggregationResult) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().aggregate(req, cont));
        Long count = r.get(HeartRateRecord.MEASUREMENTS_COUNT);
        Long max = r.get(HeartRateRecord.BPM_MAX);
        return count != null && count > 0 && max != null && max > 0 ? max : JSObject.NULL;
    }

    // Every record in the range, following page tokens: one call returns at most PAGE.
    @SuppressWarnings("unchecked")
    private <T extends Record> List<T> readAll(Class<T> type, Instant start, Instant end) throws InterruptedException {
        List<T> out = new ArrayList<>();
        String token = null;
        do {
            ReadRecordsRequest<T> req = new ReadRecordsRequest<>(JvmClassMappingKt.getKotlinClass(type),
                    TimeRangeFilter.between(start, end), Collections.emptySet(), true, PAGE, token,
                    // Disabled, not the library's default of 1: on Android 14 and later (its
                    // "upside down" client) connect-client 1.1.0-alpha12 throws NotImplementedError
                    // for any other value. Crashed the app on the first sleep read (Pixel, Android 17).
                    ReadRecordsRequest.DEDUPLICATION_STRATEGY_DISABLED);
            ReadRecordsResponse<T> res = (ReadRecordsResponse<T>)
                    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().readRecords(req, cont));
            out.addAll(res.getRecords());
            token = res.getPageToken();
        } while (token != null && !token.isEmpty());
        return out;
    }

    private static Instant[] range(PluginCall call) {
        Long start = call.getLong("start"), end = call.getLong("end");
        if (start == null || end == null || end <= start) { call.reject("start and end are required, end after start", "bad-request"); return null; }
        return new Instant[] { Instant.ofEpochMilli(start), Instant.ofEpochMilli(end) };
    }
}
