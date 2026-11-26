CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Charger telemetry lives in a hypertable, outside the Prisma-managed tables.
CREATE TABLE IF NOT EXISTS meter_values (
  time              timestamptz NOT NULL,
  charge_point_id   text        NOT NULL,
  connector_id      int,
  transaction_id    int,
  measurand         text        NOT NULL,
  value             double precision NOT NULL,
  unit              text
);
SELECT create_hypertable('meter_values', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS meter_values_cp_time ON meter_values (charge_point_id, time DESC);
