import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
  Legend,
} from 'chart.js';
import Card from '../ui/Card';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler, Legend);

const MarketChartPanel = ({ title, symbol, currentPrice, change, chartData }) => {
  const data = chartData || {
    labels: Array.from({ length: 12 }, (_, index) => `-${12 - index}h`),
    datasets: [
      {
        label: symbol,
        data: Array.from({ length: 12 }, () => 0),
        borderColor: '#60a5fa',
        backgroundColor: 'rgba(96, 165, 250, 0.16)',
        tension: 0.35,
        fill: true,
        pointRadius: 0,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        backgroundColor: '#0f172a',
        titleColor: '#fff',
        bodyColor: '#e2e8f0',
        borderColor: '#334155',
        borderWidth: 1,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#94a3b8' },
      },
      y: {
        grid: { color: 'rgba(148, 163, 184, 0.15)' },
        ticks: { color: '#94a3b8' },
      },
    },
  };

  return (
    <Card className="flex h-full flex-col gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-slate-400">{title}</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{symbol}</h2>
          <p className="mt-1 text-sm text-slate-400">Real-time market candle and price action.</p>
        </div>
        <div className="rounded-3xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-right">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Price</p>
          <p className="mt-1 text-2xl font-semibold text-white">${currentPrice?.toLocaleString() ?? '--'}</p>
          <p className={`mt-1 text-sm font-medium ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {change >= 0 ? '+' : ''}{change?.toFixed(2) ?? '0.00'}%
          </p>
        </div>
      </div>
      <div className="min-h-[320px]">
        <Line data={data} options={options} />
      </div>
    </Card>
  );
};

export default MarketChartPanel;
