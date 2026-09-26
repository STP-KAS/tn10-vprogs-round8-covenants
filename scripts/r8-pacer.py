"""R8 storm disk pacer (TN10). Every 60 s: slope of free disk over the last ~10 min; projected free at END = free - slope*remaining.
Scales the three storm runner rates (same value each) so projected free at END stays >= TARGET_GB. Writes /tmp/r7-rates.json (guard applies it).
Bounds: 40..400 per runner. Stops at END (leaves rates as they are; guard's 18:35 pruning pause then takes over)."""
import json, os, shutil, time, datetime as dt, collections
END = dt.datetime.now().replace(hour=18, minute=35, second=0, microsecond=0); TARGET = float(os.environ.get("TARGET_GB", 9.5))
LOG = "/workspace/tn10-break-test-2026-09-25/logs/round8/pacer.jsonl"; hist = collections.deque(maxlen=12)
rate = float(json.load(open("/tmp/r7-rates.json")).get("r7-ttt.rate", 400))
while dt.datetime.now() < END and not os.path.exists("/tmp/r7.HALT"):
    free = shutil.disk_usage("/").free / 1e9; now = time.time(); hist.append((now, free))
    if len(hist) >= 4:
        (t0, f0), (t1, f1) = hist[0], hist[-1]; slope = max(0.0, (f0 - f1) / ((t1 - t0) / 60))  # GB/min
        rem = (END - dt.datetime.now()).total_seconds() / 60; proj = free - slope * rem
        base = 0.008  # measured quiet growth GB/min (15:37-16:26)
        budget = max(0.0, (free - TARGET) / max(rem, 1))  # GB/min allowed
        storm_slope = max(1e-4, slope - base); allowed = max(0.0, budget - base)
        new = max(40.0, min(400.0, rate * (allowed / storm_slope) ** 0.5 if storm_slope > 0 else rate * 1.2))  # sqrt = damped step
        if abs(new - rate) >= 10:
            rate = round(new); json.dump({"r7-ttt.rate": rate, "r7-vprog.rate": rate, "r7-cov.rate": 0, "r7-ttt8.rate": rate}, open("/tmp/r7-rates.json.tmp", "w")); os.replace("/tmp/r7-rates.json.tmp", "/tmp/r7-rates.json")
        open(LOG, "a").write(json.dumps({"t": dt.datetime.now().isoformat(timespec="seconds"), "free_gb": round(free, 2), "slope_gb_min": round(slope, 4), "rem_min": round(rem, 1), "proj_gb": round(proj, 2), "budget_gb_min": round(budget, 4), "rate_each": rate}) + "\n")
    time.sleep(60)
open(LOG, "a").write(json.dumps({"t": dt.datetime.now().isoformat(timespec="seconds"), "ev": "end"}) + "\n")
