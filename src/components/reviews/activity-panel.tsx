import type { ReviewResponse } from "@/lib/reviews-client";

function shortAge(ms: number): string {
  const delta = Date.now() - ms;
  const mins = Math.round(delta / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function ActivityPanel({ activity }: { activity: ReviewResponse["activity"] }) {
  if (activity.length === 0) return null;

  return (
    <div className="activity">
      <div className="head">
        <h2>Activity</h2>
      </div>
      <div className="activity-list">
        {activity.map((item) => (
          <div className="activity-row" key={`${item.kind}-${item.id}`}>
            <span className="t num">{shortAge(item.atMs)}</span>
            <span>
              {item.title}
              {item.detail ? (
                <>
                  {" "}
                  · <span className="mono">{item.detail}</span>
                </>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
