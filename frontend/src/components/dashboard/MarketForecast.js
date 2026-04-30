import React from 'react';
import Card from '../ui/Card';

const MarketForecast = React.memo(({ cryptoData, formatCurrency }) => {
  // Calculate forecast dynamically based on current price
  const calculateForecast = (price) => ({
    trend: Math.random() > 0.5 ? 'bullish' : 'bearish',
    support: price * 0.95,
    resistance: price * 1.05,
  });

  return (
    <Card>
      <h2 className="mb-6 text-xl font-semibold text-white">Market Forecast</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {cryptoData.slice(0, 3).map((crypto) => {
          const forecast = calculateForecast(crypto.price);
          return (
            <div key={crypto.symbol} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
              <div className="mb-4 flex items-center gap-3">
                <img
                  src={crypto.icon}
                  alt={crypto.name}
                  className="h-8 w-8 rounded-full"
                />
                <h3 className="text-lg font-semibold text-white">{crypto.symbol}</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-slate-400">Current Price</span>
                  <span className="text-sm font-medium text-white">{formatCurrency(crypto.price)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-400">Trend Signal</span>
                  <span className={`text-sm font-medium ${forecast.trend === 'bullish' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {forecast.trend.toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-400">Support</span>
                  <span className="text-sm font-medium text-white">{formatCurrency(forecast.support)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-400">Resistance</span>
                  <span className="text-sm font-medium text-white">{formatCurrency(forecast.resistance)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
});

export default MarketForecast;
