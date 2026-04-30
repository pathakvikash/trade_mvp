import React, { useMemo } from 'react';
import useMarketStore from '../store/marketStore';
import LiquidationHeatmap from '../components/LiquidationHeatmap';
import Card from '../components/ui/Card';

// Move static data outside component to avoid dependency issues
const holdingsBase = [
    {
        symbol: 'BTC',
        name: 'Bitcoin',
        amount: 0.5,
        avgBuyPrice: 35000,
        icon: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
    },
    {
        symbol: 'ETH',
        name: 'Ethereum',
        amount: 4.2,
        avgBuyPrice: 2000,
        icon: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
    },
];

const Liquidation = () => {
    const marketData = useMarketStore((state) => state.marketData);
    const socketStatus = useMarketStore((state) => state.socketStatus);

    const holdings = useMemo(() => {
        if (!marketData || marketData.length === 0) {
            return holdingsBase.map(h => ({
                ...h,
                currentPrice: 0,
                value: 0,
                pnL: 0,
                pnLPercentage: 0,
            }));
        }

        return holdingsBase.map(holding => {
            const marketCoin = marketData.find(
                m => m.symbol.toUpperCase() === holding.symbol.toUpperCase()
            );
            const currentPrice = marketCoin ? marketCoin.current_price : 0;
            const value = holding.amount * currentPrice;
            const costBasis = holding.amount * holding.avgBuyPrice;
            const pnL = value - costBasis;
            const pnLPercentage = costBasis > 0 ? (pnL / costBasis) * 100 : 0;

            return {
                ...holding,
                currentPrice,
                value,
                pnL,
                pnLPercentage,
            };
        });
    }, [marketData]);

    const isLoading = marketData.length === 0 && socketStatus === 'connecting';
    const hasError = socketStatus === 'error';

    if (isLoading) {
        return (
            <div className="flex min-h-full items-center justify-center">
                <Card className="text-center">
                    <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent mx-auto"></div>
                    <p className="text-slate-300">Loading liquidation data...</p>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6 min-h-0">
            {hasError && (
                <Card className="border-red-800/50 bg-red-950/20">
                    <p className="text-red-300">Unable to load market data. Liquidation analysis may be incomplete.</p>
                </Card>
            )}

            <Card>
                <h1 className="mb-4 text-2xl font-bold text-white">Liquidation Risk Analysis</h1>
                <p className="text-slate-400">
                    Monitor liquidation levels and risk exposure for your crypto holdings. The heatmap
                    shows liquidation volume at different price levels to help you understand market risk.
                </p>
            </Card>

            <LiquidationHeatmap holdings={holdings} currentPrices={marketData} />
        </div>
    );
};

export default Liquidation;
