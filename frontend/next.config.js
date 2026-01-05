const { adapter } = require('@aws-amplify/adapter-nextjs');
const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname, '../'),
};

module.exports = adapter(nextConfig);
