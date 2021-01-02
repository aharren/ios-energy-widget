# iOS Energy Widget

A [Scriptable.app](https://scriptable.app)-based iOS widget which visualizes the energy production and energy consumption of your house from the last 24 hours.

Data is read from a Grafana server, e.g. with an InfluxDB time-series database as data store.

## Example

![](example.png)

Visualized data:

- Top - from left to right:
  - Consumption mix (in kWh): photovoltaics consumption (yellow), battery consumption (orange), grid consumption (red); with a full circle of 15
  - Grid feed (in kWh): energy fed into the grid (green); with a full circle of 25
  - Production mix (in kWh): photovoltaics consumption (yellow), battery charge (blue), grid feed (green)
  - Battery state: current battery charge level as percentage
 
 - Bottom:
   - Stacked values in 15-minutes intervals
