import React from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../ui/Card';
import Button from '../ui/Button';

const MarketOverview = React.memo(({ cryptoData, formatCurrency, formatPercentage, formatMarketCap }) => {
  const navigate = useNavigate();

  return (
    <Card>
      <h2 className="mb-6 text-xl font-semibold text-white">Market Overview</h2>
      <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/70">
        <div className="max-h-[30rem] overflow-y-auto">
          <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="pb-3 text-left text-sm font-medium text-slate-400">Asset</th>
              <th className="pb-3 text-left text-sm font-medium text-slate-400">Price</th>
              <th className="pb-3 text-left text-sm font-medium text-slate-400">24h Change</th>
              <th className="pb-3 text-left text-sm font-medium text-slate-400">Market Cap</th>
              <th className="pb-3 text-left text-sm font-medium text-slate-400">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {cryptoData.map((crypto) => (
              <tr key={crypto.symbol} className="hover:bg-slate-900/30">
                <td className="py-4">
                  <div className="flex items-center gap-3">
                    <img
                      src={crypto.icon}
                      alt={crypto.name}
                      className="h-8 w-8 rounded-full"
                    />
                    <div>
                      <div className="font-medium text-white">{crypto.name}</div>
                      <div className="text-sm text-slate-400">{crypto.symbol}</div>
                    </div>
                  </div>
                </td>
                <td className="py-4 text-white">{formatCurrency(crypto.price)}</td>
                <td className={`py-4 ${crypto.priceChange24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatPercentage(crypto.priceChange24h)}
                </td>
                <td className="py-4 text-white">{formatMarketCap(crypto.marketCap)}</td>
                <td className="py-4">
                  <Button
                    size="sm"
                    onClick={() => navigate(`/trade?symbol=${crypto.symbol}`)}
                  >
                    Trade
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </Card>
  );
});

export default MarketOverview;
