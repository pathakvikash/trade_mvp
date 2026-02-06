import React, { useMemo } from 'react';
import styles from '../styles/globalStyles';

const LiquidationHeatmap = ({ holdings, currentPrices }) => {
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

    const calculateRiskLevel = (currentPrice, levels) => {
        const lowestLevel = levels.length > 0 ? Math.min(...levels.map(l => l.priceLevel)) : 0;
        const distance = currentPrice - lowestLevel;
        const percentageDistance = (distance / currentPrice) * 100;

        if (percentageDistance > 30) return 'low';
        if (percentageDistance > 15) return 'medium';
        return 'high';
    };

    const findNearestLiquidation = (currentPrice, levels) => {
        if (levels.length === 0) return null;

        const nearestBelow = levels
            .filter(l => l.priceLevel < currentPrice)
            .reduce((prev, curr) =>
                Math.abs(curr.priceLevel - currentPrice) < Math.abs(prev.priceLevel - currentPrice)
                    ? curr
                    : prev,
                levels[0]
            );

        return nearestBelow;
    };

    const getRiskColor = (riskLevel) => {
        switch (riskLevel) {
            case 'high':
                return '#ef4444';
            case 'medium':
                return '#f59e0b';
            case 'low':
                return '#10b981';
            default:
                return '#6b7280';
        }
    };

    const getHeatmapIntensity = (liquidations, maxLiquidations) => {
        const intensity = (liquidations / maxLiquidations) * 100;
        // Color from light to dark red based on liquidation intensity
        const hue = 0; // red hue
        const lightness = 90 - (intensity * 0.7); // 90% to 20%
        return `hsl(${hue}, 100%, ${lightness}%)`;
    };

    const formatCurrency = (value, decimals = 2) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        }).format(value);
    };

    // Calculate liquidation risk for each holding
    const liquidationRisk = useMemo(() => {
        return holdings.map(holding => {
            const liquidationLevels = MOCK_LIQUIDATION_DATA[holding.symbol] || [];

            // Find current price index to determine proximity to liquidation levels
            const currentPrice = holding.currentPrice;
            const riskLevel = calculateRiskLevel(currentPrice, liquidationLevels);

            return {
                symbol: holding.symbol,
                name: holding.name,
                currentPrice,
                amount: holding.amount,
                liquidationLevels,
                riskLevel,
                distanceToLiquidation: findNearestLiquidation(currentPrice, liquidationLevels),
            };
        });
    }, [holdings]);

    return (
        <div style={styles.dashboardContainer}>
            {/* Risk Summary */}
            <div style={styles.dashboardSection}>
                <h2 style={styles.sectionTitle}>Liquidation Risk Overview</h2>
                <div style={styles.riskSummaryGrid}>
                    {liquidationRisk.map(risk => (
                        <div key={risk.symbol} style={styles.riskCard}>
                            <div style={styles.riskCardHeader}>
                                <h3 style={styles.riskCardTitle}>{risk.name}</h3>
                                <span
                                    style={{
                                        ...styles.riskBadge,
                                        backgroundColor: getRiskColor(risk.riskLevel),
                                    }}
                                >
                                    {risk.riskLevel.toUpperCase()}
                                </span>
                            </div>
                            <div style={styles.riskCardContent}>
                                <div style={styles.riskMetric}>
                                    <span>Current Price:</span>
                                    <strong>{formatCurrency(risk.currentPrice)}</strong>
                                </div>
                                <div style={styles.riskMetric}>
                                    <span>Nearest Liquidation:</span>
                                    <strong>{formatCurrency(risk.distanceToLiquidation.priceLevel)}</strong>
                                </div>
                                <div style={styles.riskMetric}>
                                    <span>Distance:</span>
                                    <strong>
                                        {(
                                            ((risk.currentPrice - risk.distanceToLiquidation.priceLevel) /
                                                risk.currentPrice) * 100
                                        ).toFixed(2)}%
                                    </strong>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Liquidation Heatmap Levels */}
            <div style={styles.dashboardSection}>
                <h2 style={styles.sectionTitle}>Liquidation Levels Heatmap</h2>
                {liquidationRisk.map(risk => {
                    const maxLiquidations = Math.max(...risk.liquidationLevels.map(l => l.liquidations));

                    return (
                        <div key={risk.symbol} style={styles.heatmapContainer}>
                            <h3 style={styles.heatmapTitle}>{risk.name} ({risk.symbol})</h3>
                            <div style={styles.heatmapContent}>
                                {/* Y-axis labels */}
                                <div style={styles.heatmapYAxis}>
                                    {risk.liquidationLevels.map(level => (
                                        <div key={level.priceLevel} style={styles.heatmapYLabel}>
                                            {formatCurrency(level.priceLevel, 0)}
                                        </div>
                                    ))}
                                </div>

                                {/* Heatmap bars */}
                                <div style={styles.heatmapBars}>
                                    {risk.liquidationLevels.map(level => {
                                        const isCurrentPrice = Math.abs(level.priceLevel - risk.currentPrice) < risk.currentPrice * 0.02;

                                        return (
                                            <div key={level.priceLevel} style={styles.heatmapBarRow}>
                                                <div
                                                    style={{
                                                        ...styles.heatmapBar,
                                                        backgroundColor: getHeatmapIntensity(level.liquidations, maxLiquidations),
                                                        borderLeft: isCurrentPrice ? '3px solid #2563eb' : 'none',
                                                        opacity: isCurrentPrice ? 1 : 0.8,
                                                    }}
                                                    title={`${level.liquidations} liquidations`}
                                                >
                                                    <span style={styles.heatmapValue}>{level.liquidations}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Current price indicator */}
                            <div style={styles.heatmapLegend}>
                                <div style={styles.legendItem}>
                                    <div style={{ ...styles.legendColor, backgroundColor: '#2563eb' }}></div>
                                    <span>Current Price: {formatCurrency(risk.currentPrice)}</span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Legend */}
            <div style={styles.dashboardSection}>
                <h3 style={styles.sectionTitle}>Legend</h3>
                <div style={styles.legendGrid}>
                    <div style={styles.legendItem}>
                        <div style={{ ...styles.legendColor, backgroundColor: '#ef4444' }}></div>
                        <span>High Risk (Distance &lt; 15%)</span>
                    </div>
                    <div style={styles.legendItem}>
                        <div style={{ ...styles.legendColor, backgroundColor: '#f59e0b' }}></div>
                        <span>Medium Risk (Distance 15-30%)</span>
                    </div>
                    <div style={styles.legendItem}>
                        <div style={{ ...styles.legendColor, backgroundColor: '#10b981' }}></div>
                        <span>Low Risk (Distance &gt; 30%)</span>
                    </div>
                    <div style={styles.legendItem}>
                        <div style={{ ...styles.legendColor, backgroundColor: '#f5f5dc' }}></div>
                        <span>Low Liquidation Volume</span>
                    </div>
                    <div style={styles.legendItem}>
                        <div style={{ ...styles.legendColor, backgroundColor: '#8b0000' }}></div>
                        <span>High Liquidation Volume</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LiquidationHeatmap;
