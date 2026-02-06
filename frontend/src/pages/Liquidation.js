import React, { useMemo } from 'react';
import styles from '../styles/globalStyles';
import useMarketStore from '../store/marketStore';
import LiquidationHeatmap from '../components/LiquidationHeatmap';

const Liquidation = () => {
    const marketData = useMarketStore((state) => state.marketData);
    const socketStatus = useMarketStore((state) => state.socketStatus);

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
            <div style={styles.loadingContainer}>
                <div style={styles.loadingSpinner}></div>
                <p>Loading liquidation data...</p>
            </div>
        );
    }

    return (
        <div style={styles.dashboardContainer}>
            {hasError && (
                <div style={{ ...styles.errorMessage, marginBottom: '20px' }}>
                    Unable to load market data. Liquidation analysis may be incomplete.
                </div>
            )}

            <div style={styles.dashboardSection}>
                <h1 style={styles.sectionTitle}>Liquidation Risk Analysis</h1>
                <p style={{ ...styles.textLight, marginBottom: '24px' }}>
                    Monitor liquidation levels and risk exposure for your crypto holdings. The heatmap
                    shows liquidation volume at different price levels to help you understand market risk.
                </p>
            </div>

            <LiquidationHeatmap holdings={holdings} currentPrices={marketData} />
        </div>
    );
};

export default Liquidation;
