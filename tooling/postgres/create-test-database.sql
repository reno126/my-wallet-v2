SELECT 'CREATE DATABASE wallet_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'wallet_test')
\gexec
