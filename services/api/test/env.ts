// Runs in every Jest worker before tests: point at the test database and enable dev login.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://evgo:evgo_dev_only@localhost:5432/evgo_test";
process.env.OTP_DEV_ECHO = "true";
process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";
