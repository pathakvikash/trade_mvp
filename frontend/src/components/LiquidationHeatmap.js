import React, { useMemo } from 'react';
import Card from '../components/ui/Card';

// Move static data outside component to avoid dependency issues
const MOCK_LIQUIDATION_DATA = {
    BTC: [
        { priceLevel: 65000, liquidationPrice: 65000, liquidations: 245 },
        { priceLevel: 60000, liquidationPrice: 60000, liquidations: 512 },
        { priceLevel: 55000, liquidationPrice: 55000, liquidations: 789 },
        { priceLevel: 50000, liquidationPrice: 50000, liquidations: 1020 },
        { priceLevel: 45000, liquidationPrice: 45000, liquidations: 1456 },
        { priceLevel: 40000, liquidationPrice: 40000, liquidations: 892 },
        { priceLevel: 35000, liquidationPrice: 35000, liquidations: 634 },
    ],
    ETH: [
        { priceLevel: 3500, liquidationPrice: 3500, liquidations: 156 },
        { priceLevel: 3000, liquidationPrice: 3000, liquidations: 312 },
        { priceLevel: 2500, liquidationPrice: 2500, liquidations: 589 },
        { priceLevel: 2000, liquidationPrice: 2000, liquidations: 756 },
        { priceLevel: 1500, liquidationPrice: 1500, liquidations: 923 },
        { priceLevel: 1000, liquidationPrice: 1000, liquidations: 445 },
    ],
};

const LiquidationHeatmap = ({ holdings }) => {

    const calculateRiskLevel = (currentPrice, levels) => {
        if (!currentPrice || levels.length === 0) return 'low';
        const lowestLevel = Math.min(...levels.map((l) => l.priceLevel));
        const distance = currentPrice - lowestLevel;
        const percentageDistance = (distance / currentPrice) * 100;

        if (percentageDistance > 30) return 'low';
        if (percentageDistance > 15) return 'medium';
        return 'high';
    };

    const findNearestLiquidation = (currentPrice, levels) => {
        if (levels.length === 0 || !currentPrice) return null;
        return levels
            .filter((l) => l.priceLevel < currentPrice)
            .reduce((prev, curr) =>
                Math.abs(curr.priceLevel - currentPrice) < Math.abs(prev.priceLevel - currentPrice)
                    ? curr
                    : prev,
                levels[0]
            );
    };

    const getRiskColorClass = (riskLevel) => {
        switch (riskLevel) {
            case 'high':
                return 'bg-red-500 text-red-950';
            case 'medium':
                return 'bg-amber-500 text-amber-950';
            case 'low':
                return 'bg-emerald-500 text-emerald-950';
            default:
                return 'bg-slate-500 text-slate-950';
        }
    };

    const getHeatmapIntensity = (liquidations, maxLiquidations) => {
        const intensity = maxLiquidations > 0 ? (liquidations / maxLiquidations) * 100 : 0;
        const lightness = 90 - Math.min(intensity * 0.7, 70);
        return `hsl(0, 100%, ${lightness}%)`;
    };

    const formatCurrency = (value, decimals = 2) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        }).format(value);
    };

    const liquidationRisk = useMemo(() => {
        return holdings.map((holding) => {
            const liquidationLevels = MOCK_LIQUIDATION_DATA[holding.symbol] || [];
            const currentPrice = holding.currentPrice || 0;
            const riskLevel = calculateRiskLevel(currentPrice, liquidationLevels);
            return {
                ...holding,
                liquidationLevels,
                riskLevel,
                nearestLiquidation: findNearestLiquidation(currentPrice, liquidationLevels),
            };
        });
    }, [holdings]);

    return (
        <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
                {liquidationRisk.map((risk) => (
                    <Card key={risk.symbol} className="border-slate-800 bg-slate-950/95">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <h3 className="text-lg font-semibold text-white">{risk.name}</h3>
                                <p className="text-sm text-slate-400">{risk.symbol} liquidation summary</p>
                            </div>
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getRiskColorClass(risk.riskLevel)}`}>
                                {risk.riskLevel.toUpperCase()}
                            </span>
                        </div>
                        <div className="mt-6 space-y-3 rounded-3xl border border-slate-800 bg-slate-900/60 p-4">
                            <div className="flex items-center justify-between text-sm text-slate-400">
                                <span>Current Price</span>
                                <span className="font-semibold text-white">{formatCurrency(risk.currentPrice)}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm text-slate-400">
                                <span>Nearest Liquidation</span>
                                <span className="font-semibold text-white">
                                    {risk.nearestLiquidation ? formatCurrency(risk.nearestLiquidation.priceLevel) : 'N/A'}
                                </span>
                            </div>
                            <div className="flex items-center justify-between text-sm text-slate-400">
                                <span>Distance</span>
                                <span className="font-semibold text-white">
                                    {risk.nearestLiquidation
                                        ? `${(((risk.currentPrice - risk.nearestLiquidation.priceLevel) / risk.currentPrice) * 100).toFixed(2)}%`
                                        : 'N/A'}
                                </span>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>

            <div className="space-y-6">
                {liquidationRisk.map((risk) => {
                    const maxLiquidations = risk.liquidationLevels.length > 0 ? Math.max(...risk.liquidationLevels.map((l) => l.liquidations)) : 0;
                    return (
                        <Card key={`heatmap-${risk.symbol}`} className="border-slate-800 bg-slate-950/95">
                            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <h3 className="text-lg font-semibold text-white">{risk.name} ({risk.symbol})</h3>
                                    <p className="text-sm text-slate-400">Liquidation levels across price zones</p>
                                </div>
                                <div className="text-sm text-slate-400">
                                    Current price: <span className="font-semibold text-white">{formatCurrency(risk.currentPrice)}</span>
                                </div>
                            </div>
                            <div className="space-y-3">
                                {risk.liquidationLevels.map((level) => {
                                    const isCurrentPrice = Math.abs(level.priceLevel - risk.currentPrice) < risk.currentPrice * 0.02;
                                    return (
                                        <div key={level.priceLevel} className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)] items-center">
                                            <div className="text-sm text-slate-400">{formatCurrency(level.priceLevel, 0)}</div>
                                            <div className="relative h-10 overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/70">
                                                <div
                                                    className="absolute inset-y-0 left-0 rounded-l-3xl"
                                                    style={{
                                                        width: `${maxLiquidations ? (level.liquidations / maxLiquidations) * 100 : 0}%`,
                                                        backgroundColor: getHeatmapIntensity(level.liquidations, maxLiquidations),
                                                    }}
                                                />
                                                <div className="relative z-10 flex h-full items-center justify-end pr-4 text-sm font-semibold text-white">
                                                    {level.liquidations}
                                                </div>
                                                {isCurrentPrice && <div className="absolute inset-y-0 right-0 w-1 rounded-r-3xl bg-brand-500" />}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </Card>
                    );
                })}
            </div>

            <Card className="border-slate-800 bg-slate-950/95">
                <h3 className="text-lg font-semibold text-white">Legend</h3>
                <div className="grid gap-3 sm:grid-cols-2 mt-4">
                    <div className="flex items-center gap-3 rounded-3xl border border-slate-800 bg-slate-900/60 p-3">
                        <span className="h-3 w-3 rounded-full bg-red-500"></span>
                        <span className="text-sm text-slate-300">High Risk (distance &lt; 15%)</span>
                    </div>
                    <div className="flex items-center gap-3 rounded-3xl border border-slate-800 bg-slate-900/60 p-3">
                        <span className="h-3 w-3 rounded-full bg-amber-500"></span>
                        <span className="text-sm text-slate-300">Medium Risk (distance 15-30%)</span>
                    </div>
                    <div className="flex items-center gap-3 rounded-3xl border border-slate-800 bg-slate-900/60 p-3">
                        <span className="h-3 w-3 rounded-full bg-emerald-500"></span>
                        <span className="text-sm text-slate-300">Low Risk (distance &gt; 30%)</span>
                    </div>
                    <div className="flex items-center gap-3 rounded-3xl border border-slate-800 bg-slate-900/60 p-3">
                        <span className="h-3 w-3 rounded-full bg-slate-500"></span>
                        <span className="text-sm text-slate-300">Low liquidation volume</span>
                    </div>
                </div>
            </Card>
        </div>
    );
};

export default LiquidationHeatmap;
