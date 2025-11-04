// src/CandlestickChart.js

import React, { useEffect } from 'react';
import * as d3 from 'd3';

const CandlestickChart = ({ data }) => {
    useEffect(() => {
        if (!data || data.length === 0) {
            d3.select("#candlestick-chart").html("<p>No data available for candlestick chart.</p>");
            return;
        }

        d3.select("#candlestick-chart").select("svg").remove(); // Clear previous chart

        const container = d3.select("#candlestick-chart");
        const containerWidth = container.node().getBoundingClientRect().width;
        const containerHeight = 400; // Fixed height for consistency, or make it dynamic

        // Set dimensions and margins
        const margin = { top: 20, right: 30, bottom: 30, left: 40 };
        const width = containerWidth - margin.left - margin.right;
        const height = containerHeight - margin.top - margin.bottom;

        // Create SVG
        const svg = container
            .append("svg")
            .attr("width", containerWidth)
            .attr("height", containerHeight)
            .append("g")
            .attr("transform", `translate(${margin.left}, ${margin.top})`);

        // Set the scales
        const x = d3.scaleBand()
            .domain(data.map(d => d.date.getTime())) // Use getTime() for comparison
            .range([0, width])
            .padding(0.2);

        const y = d3.scaleLinear()
            .domain([d3.min(data, d => d.low), d3.max(data, d => d.high)])
            .range([height, 0]);

        // Draw the axes
        svg.append("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0, ${height})`)
            .call(d3.axisBottom(x).tickFormat(d => d3.timeFormat("%Y-%m-%d")(new Date(d))));

        svg.append("g")
            .attr("class", "y-axis")
            .call(d3.axisLeft(y));

        // Draw the candlesticks
        svg.selectAll(".candlestick")
            .data(data)
            .enter()
            .append("g")
            .attr("class", "candlestick")
            .attr("transform", d => `translate(${x(d.date.getTime())}, 0)`)

            // Draw the line (high-low)
            .append("line")
            .attr("x1", x.bandwidth() / 2)
            .attr("x2", x.bandwidth() / 2)
            .attr("y1", d => y(d.high))
            .attr("y2", d => y(d.low))
            .attr("stroke", "black");

        svg.selectAll(".candlestick")
            .append("rect")
            .attr("x", 0)
            .attr("y", d => y(Math.max(d.open, d.close)))
            .attr("height", d => Math.abs(y(d.open) - y(d.close)))
            .attr("width", x.bandwidth())
            .attr("class", d => d.close >= d.open ? "up" : "down");
    }, [data]);

    return (
        <div id="candlestick-chart">
            <style jsx>{`
                .up {
                    fill: #10b981; /* Green */
                    stroke: #10b981;
                }
                .down {
                    fill: #ef4444; /* Red */
                    stroke: #ef4444;
                }
                .candlestick line {
                    stroke: black;
                }
            `}</style>
        </div>
    );
};

export default CandlestickChart;