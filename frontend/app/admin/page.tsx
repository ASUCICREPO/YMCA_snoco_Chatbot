'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Authenticator } from '@aws-amplify/ui-react';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import '@aws-amplify/ui-react/styles.css';

// Configure Amplify
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID || '',
      userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID || '',
    }
  }
});

interface AnalyticsData {
  stats: {
    totalQueries: number;
    successRate: number;
    avgProcessingTime: number;
    avgCitations: number;
    languageBreakdown: Record<string, number>;
    uniqueUsers: number;
    totalConversations: number;
  };
  trendingTopics: Array<{ topic: string; count: number }>;
  usageTimeline: Array<{ date: string; count: number }>;
  recentQueries: Array<{
    timestamp: string;
    query: string;
    language: string;
    citations: number;
    processingTime: number;
  }>;
  timeRange: string;
}

export default function AdminDashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('7d');
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = async (range: string) => {
    try {
      setLoading(true);
      setError(null);

      // Get Cognito credentials
      const session = await fetchAuthSession();
      const credentials = session.credentials;

      if (!credentials) {
        throw new Error('Not authenticated');
      }

      // Initialize DynamoDB client with Cognito credentials
      const dynamoClient = DynamoDBDocumentClient.from(
        new DynamoDBClient({
          region: process.env.NEXT_PUBLIC_REGION || 'us-west-2',
          credentials: credentials,
        }),
        { marshallOptions: { removeUndefinedValues: true } }
      );

      const ANALYTICS_TABLE = process.env.NEXT_PUBLIC_ANALYTICS_TABLE_NAME || 'ymca-analytics';
      const CONVERSATION_TABLE = process.env.NEXT_PUBLIC_CONVERSATION_TABLE_NAME || 'ymca-conversations';

      const now = Date.now();
      const timeRangeMs = {
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
        '90d': 90 * 24 * 60 * 60 * 1000,
      }[range] || 7 * 24 * 60 * 60 * 1000;

      const startTime = now - timeRangeMs;

      // Fetch analytics and conversations in parallel
      const [analyticsResult, conversationsResult] = await Promise.all([
        dynamoClient.send(new ScanCommand({
          TableName: ANALYTICS_TABLE,
          FilterExpression: '#ts > :startTime',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: { ':startTime': startTime },
        })),
        dynamoClient.send(new ScanCommand({
          TableName: CONVERSATION_TABLE,
          FilterExpression: '#ts > :startTime',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: { ':startTime': startTime },
          Limit: 100,
        })),
      ]);

      const analytics = analyticsResult.Items || [];
      const conversations = conversationsResult.Items || [];

      // Process analytics
      const stats = {
        totalQueries: analytics.length,
        successRate: analytics.length > 0 ? analytics.filter((a) => a.success).length / analytics.length : 0,
        avgProcessingTime: analytics.length > 0 ? analytics.reduce((sum: number, a) => sum + (a.processingTimeMs || 0), 0) / analytics.length : 0,
        avgCitations: analytics.length > 0 ? analytics.reduce((sum: number, a) => sum + (a.citationsFound || 0), 0) / analytics.length : 0,
        languageBreakdown: {} as Record<string, number>,
        uniqueUsers: new Set(analytics.map((a) => a.userId)).size,
        totalConversations: new Set(analytics.map((a) => a.conversationId)).size,
      };

      analytics.forEach((item) => {
        const lang = item.language || 'unknown';
        stats.languageBreakdown[lang] = (stats.languageBreakdown[lang] || 0) + 1;
      });

      // Extract trending topics
      const queryTexts = conversations.map((c) => c.userMessage?.toLowerCase() || '');
      const wordCounts: Record<string, number> = {};
      queryTexts.forEach((text: string) => {
        text.split(/\s+/).filter((w: string) => w.length > 4).forEach((word: string) => {
          wordCounts[word] = (wordCounts[word] || 0) + 1;
        });
      });

      const trendingTopics = Object.entries(wordCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20)
        .map(([word, count]) => ({ topic: word, count }));

      // Usage over time
      const usageByDay: Record<string, number> = {};
      analytics.forEach((item) => {
        const date = new Date(item.timestamp).toISOString().split('T')[0];
        usageByDay[date] = (usageByDay[date] || 0) + 1;
      });

      const usageTimeline = Object.entries(usageByDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count }));

      // Recent queries
      const recentQueries = conversations
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10)
        .map((c) => ({
          timestamp: new Date(c.timestamp).toISOString(),
          query: c.userMessage,
          language: c.userLanguage,
          citations: c.citationsCount || 0,
          processingTime: c.processingTimeMs,
        }));

      setData({ stats, trendingTopics, usageTimeline, recentQueries, timeRange: range });
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics(timeRange);
  }, [timeRange]);

  const handleTimeRangeChange = (range: string) => {
    setTimeRange(range);
  };

  return (
    <Authenticator>
      {({ signOut }) => (
        <div className="min-h-screen bg-gray-50">
          {/* Header */}
          <header className="bg-white border-b border-gray-200">
            <div className="max-w-7xl mx-auto px-[24px] py-[16px] flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Link href="/" className="text-[#0089d0] hover:text-[#0077b8] transition-colors">
                  ← Back to Chat
                </Link>
                <h1 className="text-2xl font-bold text-[#231f20]">Admin Dashboard</h1>
              </div>

              <div className="flex items-center gap-4">
                {/* Time Range Selector */}
                <div className="flex gap-2">
                  {['7d', '30d', '90d'].map((range) => (
                    <button
                      key={range}
                      onClick={() => handleTimeRangeChange(range)}
                      className={`px-4 py-2 rounded-[100px] transition-colors ${timeRange === range
                        ? 'bg-[#0089d0] text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                    >
                      {range === '7d' ? 'Last 7 Days' : range === '30d' ? '30 Days' : '90 Days'}
                    </button>
                  ))}
                </div>

                <button
                  onClick={signOut}
                  className="text-sm text-red-600 hover:text-red-800 font-medium px-4 py-2 hover:bg-red-50 rounded-full transition-colors"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </header>

          <main className="max-w-7xl mx-auto px-[24px] py-[24px]">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[#0089d0]"></div>
                  <p className="mt-4 text-gray-600">Loading analytics...</p>
                </div>
              </div>
            ) : error ? (
              <div className="bg-white rounded-[12px] shadow-lg p-8 max-w-md mx-auto mt-12 text-center">
                <h2 className="text-xl font-bold text-red-600 mb-4">Error Loading Analytics</h2>
                <p className="text-gray-600 mb-4">{error}</p>
                <button
                  onClick={() => fetchAnalytics(timeRange)}
                  className="bg-[#0089d0] text-white px-6 py-2 rounded-[100px] hover:bg-[#0077b8] transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : data ? (
              <>
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                  <StatCard
                    title="Total Queries"
                    value={data.stats.totalQueries.toLocaleString()}
                    color="bg-[#0089d0]"
                  />
                  <StatCard
                    title="Success Rate"
                    value={`${(data.stats.successRate * 100).toFixed(1)}%`}
                    color="bg-[#01a490]"
                  />
                  <StatCard
                    title="Unique Users"
                    value={data.stats.uniqueUsers.toLocaleString()}
                    color="bg-[#f47920]"
                  />
                  <StatCard
                    title="Avg Citations"
                    value={data.stats.avgCitations.toFixed(1)}
                    color="bg-[#92278f]"
                  />
                </div>

                {/* Performance Metrics */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                  <MetricCard
                    title="Performance"
                    metrics={[
                      { label: 'Avg Processing Time', value: `${data.stats.avgProcessingTime.toFixed(0)}ms` },
                      { label: 'Total Conversations', value: data.stats.totalConversations.toLocaleString() },
                    ]}
                  />
                  <MetricCard
                    title="Language Distribution"
                    metrics={Object.entries(data.stats.languageBreakdown).map(([lang, count]) => ({
                      label: lang.toUpperCase(),
                      value: count.toString(),
                    }))}
                  />
                </div>

                {/* Trending Topics */}
                <div className="bg-white rounded-[12px] shadow-sm border border-[#d1d5dc] p-6 mb-8">
                  <h2 className="text-xl font-bold text-[#231f20] mb-4">Trending Topics</h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {data.trendingTopics.map((topic, index) => (
                      <div
                        key={index}
                        className="bg-gray-50 rounded-[12px] p-3 border border-gray-200"
                      >
                        <p className="text-sm font-medium text-[#231f20] truncate">{topic.topic}</p>
                        <p className="text-xs text-[#636466] mt-1">{topic.count} mentions</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent Queries */}
                <div className="bg-white rounded-[12px] shadow-sm border border-[#d1d5dc] p-6">
                  <h2 className="text-xl font-bold text-[#231f20] mb-4">Recent Queries</h2>
                  <div className="space-y-4">
                    {data.recentQueries.map((query, index) => (
                      <div
                        key={index}
                        className="border-b border-gray-100 pb-4 last:border-0 last:pb-0"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <p className="text-[#231f20] font-medium flex-1 mr-4">{query.query}</p>
                          <span className="text-xs text-[#636466] whitespace-nowrap">
                            {new Date(query.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex gap-4 text-xs text-[#636466]">
                          <span>Language: {query.language.toUpperCase()}</span>
                          <span>Citations: {query.citations}</span>
                          <span>Time: {query.processingTime}ms</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </main>
        </div>
      )}
    </Authenticator>
  );
}

// Stat Card Component
const StatCard = ({ title, value, color }: { title: string; value: string; color: string }) => (
  <div className={`${color} text-white rounded-[12px] p-6 shadow-sm`}>
    <p className="text-sm opacity-90 mb-2">{title}</p>
    <p className="text-3xl font-bold">{value}</p>
  </div>
);

// Metric Card Component
const MetricCard = ({ title, metrics }: { title: string; metrics: Array<{ label: string; value: string }> }) => (
  <div className="bg-white rounded-[12px] shadow-sm border border-[#d1d5dc] p-6">
    <h3 className="text-lg font-bold text-[#231f20] mb-4">{title}</h3>
    <div className="space-y-3">
      {metrics.map((metric, index) => (
        <div key={index} className="flex justify-between items-center">
          <span className="text-[#636466]">{metric.label}</span>
          <span className="text-[#231f20] font-medium">{metric.value}</span>
        </div>
      ))}
    </div>
  </div>
);
