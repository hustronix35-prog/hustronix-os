"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReportChartPoint } from "@/data/reports";

export type ReportLineChartProps = {
  data: ReportChartPoint[];
  /** X-axis label (e.g. `May 11`) for overload marker; omit to hide. */
  overloadDay?: string | null;
};

export function ReportLineChartInner({ data, overloadDay }: ReportLineChartProps) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
          <XAxis dataKey="date" stroke="#9ca3af" tick={{ fontSize: 11 }} />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            stroke="#9ca3af"
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{
              background: "#121212",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
            }}
            labelStyle={{ color: "#ededed" }}
          />
          {overloadDay && data.some((d) => d.date === overloadDay) && (
            <ReferenceLine
              x={overloadDay}
              stroke="#ff4d4d"
              strokeDasharray="4 4"
              label={{
                value: "Peak load",
                fill: "#ff4d4d",
                fontSize: 10,
                position: "top",
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="success"
            name="Execution Success Rate"
            stroke="#2ecc71"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="load"
            name="System Load %"
            stroke="#ff4d4d"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
