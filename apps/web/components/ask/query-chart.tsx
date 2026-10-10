"use client";

import type { AskChartSpec } from "@eureka-atlas/types";
import { chartColors, type ChartData, type ChartPoint } from "./chart-data";


const tick = (value: number) => new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const tip = (point: ChartPoint, data: ChartData) => point.label + "\n" + data.names.map((name, index) => name + "：" + point.raw[index] + (data.unit ? " " + data.unit : "")).join("\n");

/** SVG is part of the HTML document; saved values remain exact in titles and the result table. */
export function QueryChart({ data, spec }: { data: ChartData; spec: AskChartSpec }) {
  if (data.error) return <p role="status" className="py-8 text-center text-xs text-slate-500">{data.error}</p>;
  const { points, names, unit } = data;
  if (spec.type === "pie") {
    const maximum = Math.max(...points.map((point) => point.values[0] ?? 0));
    const weights = points.map((point) => (point.values[0] ?? 0) / maximum);
    const total = weights.reduce((sum, value) => sum + value, 0);

    const positiveCount = weights.filter((weight) => weight > 0).length;
    return <svg xmlns="http://www.w3.org/2000/svg" viewBox={"0 0 720 " + Math.max(340, points.length * 20 + 60)} role="img" aria-label={spec.title} className="block w-full min-w-[600px] text-[12px]" fontFamily="sans-serif" fontSize="12">
      <title>{spec.title}</title>
      {points.map((point, index) => {
        const fraction = weights[index] / total;
        if (!fraction) return null;
        const start = -Math.PI / 2 + weights.slice(0, index).reduce((sum, weight) => sum + weight, 0) / total * 2 * Math.PI;
        const angle = start + fraction * 2 * Math.PI;
        const path = "M 210 165 L " + (210 + Math.cos(start) * 125) + " " + (165 + Math.sin(start) * 125) + " A 125 125 0 " + (fraction > .5 ? 1 : 0) + " 1 " + (210 + Math.cos(angle) * 125) + " " + (165 + Math.sin(angle) * 125) + " Z";
        return <g key={index}>{positiveCount === 1 ? <circle cx="210" cy="165" r="125" fill={chartColors[index % chartColors.length]}><title>{tip(point, data)}</title></circle> : <path d={path} fill={chartColors[index % chartColors.length]} stroke="white" strokeWidth="2"><title>{tip(point, data) + "\n占比：" + (fraction * 100).toFixed(1) + "%"}</title></path>}</g>;
      })}
      {points.map((point, index) => <g key={index}>
        <rect x="380" y={35 + index * 20} width="10" height="10" rx="2" fill={chartColors[index % chartColors.length]} />
        <text x="398" y={44 + index * 20} fill="#475569"><title>{tip(point, data)}</title>{point.label.length > 16 ? point.label.slice(0, 16) + "…" : point.label} · {point.raw[0]}{unit ? " " + unit : ""}</text>
      </g>)}
    </svg>;
  }
  const width = Math.max(720, Math.min(18000, points.length * (spec.type === "bar" ? 44 : 16)));
  const height = 360;
  const left = 86, right = width - 22, top = 35, bottom = height - 86;
  let magnitude = 1, minimum = 0, maximum = 0;
  for (const point of points) for (const value of point.values) if (value !== null) {
    magnitude = Math.max(magnitude, Math.abs(value)); minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
  }
  const low = minimum / magnitude, high = maximum ? maximum / magnitude : minimum ? 0 : 1;
  const y = (value: number) => bottom - (value / magnitude - low) / (high - low) * (bottom - top);
  const band = (right - left) / points.length;
  const x = (index: number) => left + band * (index + .5);
  const zero = y(0);
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.min(24, Math.floor(width / 85))));
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox={"0 0 " + width + " " + height} role="img" aria-label={spec.title} className="block w-full text-[12px]" style={{ minWidth: width }} fontFamily="sans-serif" fontSize="12">
    <title>{spec.title}</title>
    <text x={left} y="18" fill="#64748b">{unit || "数值"}</text>
    {Array.from({ length: 6 }, (_, index) => {
      const normalized = low + (high - low) * index / 5;
      const position = bottom - index / 5 * (bottom - top);
      return <g key={index}><line x1={left} x2={right} y1={position} y2={position} stroke="#e2e8f0" strokeDasharray="3 3" /><text x={left - 10} y={position + 4} textAnchor="end" fill="#64748b">{tick(normalized * magnitude)}</text></g>;
    })}
    <line x1={left} x2={right} y1={zero} y2={zero} stroke="#94a3b8" />
    {points.map((point, index) => index % labelEvery === 0 || index === points.length - 1 ? <text key={index} transform={"translate(" + x(index) + " " + (bottom + 18) + ") rotate(-30)"} textAnchor="end" fill="#64748b"><title>{point.label}</title>{point.label.length > 10 ? point.label.slice(0, 10) + "…" : point.label}</text> : null)}
    {names.map((name, series) => {
      const color = chartColors[series % chartColors.length];
      if (spec.type === "bar") return <g key={name}>{points.map((point, index) => {
        const value = point.values[series];
        if (value === null) return null;
        const barWidth = Math.max(.4, band * .75 / names.length);
        return <rect key={index} x={x(index) - band * .375 + series * barWidth} y={Math.min(y(value), zero)} width={barWidth * .9} height={Math.max(value === 0 ? 0 : .5, Math.abs(y(value) - zero))} fill={color} rx="1"><title>{tip(point, data)}</title></rect>;
      })}</g>;
      const paths: string[] = [];
      let current = "";
      points.forEach((point, index) => {
        const value = point.values[series];
        if (value === null) { if (current) paths.push(current); current = ""; }
        else current += (current ? " L " : "M ") + x(index) + " " + y(value);
      });
      if (current) paths.push(current);
      return <g key={name}>
        {paths.map((path, index) => <path key={index} d={path} fill="none" stroke={color} strokeWidth="2" />)}
        {points.map((point, index) => point.values[series] === null ? null : <circle key={index} cx={x(index)} cy={y(point.values[series]!)} r={points.length <= 200 ? 3 : 2} fill={color}><title>{tip(point, data)}</title></circle>)}
      </g>;
    })}
    {points.map((point, index) => <rect key={index} x={left + band * index} y={top} width={band} height={bottom - top} fill="transparent"><title>{tip(point, data)}</title></rect>)}
  </svg>;
}