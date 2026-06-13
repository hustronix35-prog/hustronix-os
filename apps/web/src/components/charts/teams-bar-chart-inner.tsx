"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type TeamsBarChartProps = {
  data: { dept: string; pct: number }[];
};

export function TeamsBarChartInner({ data }: TeamsBarChartProps) {
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="dept" stroke="#9ca3af" tick={{ fontSize: 10 }} />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            stroke="#9ca3af"
            tick={{ fontSize: 10 }}
          />
          <Tooltip
            cursor={{ fill: "rgba(212,175,55,0.08)" }}
            contentStyle={{
              background: "#121212",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
            }}
          />
          <Bar
            dataKey="pct"
            fill="#d4af37"
            radius={[4, 4, 0, 0]}
            label={{ fill: "#ededed", fontSize: 10, position: "top" }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
