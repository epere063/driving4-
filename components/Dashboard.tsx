
import React from 'react';
import { PropertyRecord } from '../types';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { AlertTriangle, TrendingUp, Home, CheckCircle, Layers } from 'lucide-react';

interface DashboardProps {
  records: PropertyRecord[];
  onAnalyzeNew: () => void;
}

// Colors for 5 Tiers: Green -> Yellow -> Orange -> Red -> Black/DarkGray
const TIER_COLORS = ['#22c55e', '#eab308', '#f97316', '#dc2626', '#1e293b'];

const Dashboard: React.FC<DashboardProps> = ({ records, onAnalyzeNew }) => {
  // Compute Stats
  const avgScore = records.length
    ? (records.reduce((acc, curr) => acc + curr.analysis.distress_score, 0) / records.length).toFixed(1)
    : '0';

  // Actionable Leads are Tier 3 (5.6) and above
  const actionableLeads = records.filter(r => r.analysis.distress_score >= 5.6).length;
  
  // Data for Charts - 5 Tiers
  const distributionData = [
    { name: 'Tier 1: Institutional (0-2.5)', value: records.filter(r => r.analysis.distress_score <= 2.5).length, color: TIER_COLORS[0] },
    { name: 'Tier 2: Aged Retail (2.6-5.5)', value: records.filter(r => r.analysis.distress_score > 2.5 && r.analysis.distress_score <= 5.5).length, color: TIER_COLORS[1] },
    { name: 'Tier 3: Active Inv. (5.6-7.5)', value: records.filter(r => r.analysis.distress_score > 5.5 && r.analysis.distress_score <= 7.5).length, color: TIER_COLORS[2] },
    { name: 'Tier 4: High Distress (7.6-9.0)', value: records.filter(r => r.analysis.distress_score > 7.5 && r.analysis.distress_score <= 9.0).length, color: TIER_COLORS[3] },
    { name: 'Tier 5: Dilapidated (9.1+)', value: records.filter(r => r.analysis.distress_score > 9.0).length, color: TIER_COLORS[4] },
  ];

  const recentActivity = [...records].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-sm font-medium">Total Properties</span>
            <Home size={18} />
          </div>
          <div className="text-3xl font-bold text-slate-800">{records.length}</div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-sm font-medium">Avg Distress Score</span>
            <TrendingUp size={18} />
          </div>
          <div className="text-3xl font-bold text-slate-800">{avgScore}</div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-sm font-medium">Actionable Leads (T3+)</span>
            <Layers size={18} className="text-orange-500" />
          </div>
          <div className="text-3xl font-bold text-orange-600">{actionableLeads}</div>
        </div>
        <div className="flex items-center justify-center">
            <button 
                onClick={onAnalyzeNew}
                className="w-full h-full min-h-[120px] bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-md transition-all flex flex-col items-center justify-center gap-2"
            >
                <div className="p-2 bg-white/20 rounded-full">
                    <TrendingUp size={24} />
                </div>
                Analyze New Property
            </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart Section */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 min-h-[300px]">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Portfolio Distress Tiers</h3>
          {records.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={distributionData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={160} tick={{fontSize: 11}} />
                <Tooltip cursor={{fill: 'transparent'}} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {distributionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400 italic">
                No data available yet.
            </div>
          )}
        </div>

        {/* Recent List */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Recent Analyses</h3>
          <div className="space-y-3">
            {recentActivity.length > 0 ? recentActivity.map((rec) => (
              <div key={rec.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100 hover:border-slate-300 transition-colors">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-md bg-slate-200 overflow-hidden flex-shrink-0">
                         {rec.images[0] && <img src={rec.images[0].data} alt="Property" className="w-full h-full object-cover" />}
                    </div>
                    <div>
                        <div className="text-sm font-semibold text-slate-800">{rec.address}</div>
                        <div className="text-xs text-slate-500">{new Date(rec.timestamp).toLocaleDateString()}</div>
                    </div>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-bold text-white`} 
                     style={{ backgroundColor: 
                        rec.analysis.distress_score > 9.0 ? TIER_COLORS[4] :
                        rec.analysis.distress_score > 7.5 ? TIER_COLORS[3] :
                        rec.analysis.distress_score > 5.5 ? TIER_COLORS[2] :
                        rec.analysis.distress_score > 2.5 ? TIER_COLORS[1] : TIER_COLORS[0]
                     }}>
                  {rec.analysis.distress_score}
                </div>
              </div>
            )) : (
                 <div className="text-slate-400 italic text-center py-8">No analyses run yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
