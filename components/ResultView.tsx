
import React, { useState, useEffect } from 'react';
import { PropertyRecord, CategoryScore, Scorecard } from '../types';
import { CheckCircle, AlertTriangle, XCircle, Home, Hammer, ChevronLeft, ChevronRight, Maximize2, X, AlertOctagon, Info, EyeOff, Eye, Calendar, Layers, Edit3, Save, RotateCcw } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { saveRecord, saveTrainingExample } from '../services/db';

interface ResultViewProps {
  record: PropertyRecord;
  onClose: () => void;
}

const ResultView: React.FC<ResultViewProps> = ({ record: initialRecord, onClose }) => {
  const [record, setRecord] = useState<PropertyRecord>(initialRecord);
  const { analysis, metadata } = record;
  const { visibility } = analysis;
  const [selectedImageIdx, setSelectedImageIdx] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Training / Edit Mode
  const [isEditing, setIsEditing] = useState(false);
  const [editedScorecard, setEditedScorecard] = useState<Scorecard>(analysis.scorecard);

  // Initialize edited scorecard when entering edit mode
  useEffect(() => {
    if (isEditing) {
        setEditedScorecard(JSON.parse(JSON.stringify(record.analysis.scorecard)));
    }
  }, [isEditing, record]);

  // Keyboard Navigation for Fullscreen
  useEffect(() => {
      if (!isFullscreen) return;
      
      const handleKeyDown = (e: KeyboardEvent) => {
          if (e.key === 'ArrowRight') {
              setSelectedImageIdx((prev) => (prev + 1) % record.images.length);
          } else if (e.key === 'ArrowLeft') {
              setSelectedImageIdx((prev) => (prev - 1 + record.images.length) % record.images.length);
          } else if (e.key === 'Escape') {
              setIsFullscreen(false);
          }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, record.images.length]);

  // Tier Coloring
  let tierColor = 'text-green-600';
  let tierBg = 'bg-green-50 border-green-100';
  let gaugeMainColor = '#22c55e'; // Green

  if (analysis.distress_score > 9.0) {
      tierColor = 'text-slate-900';
      tierBg = 'bg-slate-100 border-slate-300';
      gaugeMainColor = '#1e293b'; // Black/Slate
  } else if (analysis.distress_score > 7.5) {
      tierColor = 'text-red-600';
      tierBg = 'bg-red-50 border-red-100';
      gaugeMainColor = '#dc2626'; // Red
  } else if (analysis.distress_score > 5.5) {
      tierColor = 'text-orange-600';
      tierBg = 'bg-orange-50 border-orange-100';
      gaugeMainColor = '#f97316'; // Orange
  } else if (analysis.distress_score > 2.5) {
      tierColor = 'text-yellow-600';
      tierBg = 'bg-yellow-50 border-yellow-100';
      gaugeMainColor = '#eab308'; // Yellow
  }

  // Gauge Data
  const gaugeData = [
    { name: 'Score', value: analysis.distress_score },
    { name: 'Remaining', value: 10 - analysis.distress_score }
  ];
  const gaugeColors = [gaugeMainColor, '#e2e8f0'];

  const nextImage = () => setSelectedImageIdx((prev) => (prev + 1) % record.images.length);
  const prevImage = () => setSelectedImageIdx((prev) => (prev - 1 + record.images.length) % record.images.length);

  // Training Logic
  const handleScoreChange = (category: keyof Scorecard, val: string) => {
      const num = val === "" ? null : parseFloat(val);
      setEditedScorecard(prev => ({
          ...prev,
          [category]: { ...prev[category], score: num }
      }));
  };

  const handleObsChange = (category: keyof Scorecard, val: string) => {
      setEditedScorecard(prev => ({
          ...prev,
          [category]: { ...prev[category], observation: val }
      }));
  };

  const saveCorrections = async () => {
      // 1. Calculate new overall score locally
      // UPDATED LOGIC: Use Top 5 Worst scores to avoid dilution
      const categories = Object.values(editedScorecard) as CategoryScore[];
      const validScores = categories.map(c => c.score).filter(s => s !== null && s !== undefined && !isNaN(s)) as number[];
      
      let newDistress = 0;
      let newTier = "Tier 1: No Data";

      if (validScores.length > 0) {
          // Sort descending (Highest/Worst first)
          validScores.sort((a, b) => b - a);
          
          // Take top 5
          const topBadScores = validScores.slice(0, 5);
          
          const sum = topBadScores.reduce((a, b) => a + b, 0);
          newDistress = parseFloat((sum / topBadScores.length).toFixed(1));
          
          if (newDistress > 9.0) newTier = "Tier 5: Dilapidated / Land Value";
          else if (newDistress > 7.5) newTier = "Tier 4: High Distress / Immediate Action";
          else if (newDistress > 5.5) newTier = "Tier 3: Active Investment Opportunity";
          else if (newDistress > 2.5) newTier = "Tier 2: Aged Retail";
          else newTier = "Tier 1: Institutional/Pristine";
      }

      // 2. Identify Changed Items for Training
      const promises = (Object.keys(editedScorecard) as Array<keyof Scorecard>).map(async (key) => {
          const oldItem = analysis.scorecard[key];
          const newItem = editedScorecard[key];

          // If score changed significantly, save as training example
          if (oldItem.score !== newItem.score) {
              await saveTrainingExample({
                  id: crypto.randomUUID(),
                  category: key,
                  observation_text: newItem.observation, // Use the NEW observation as the trigger for this score
                  corrected_score: newItem.score,
                  timestamp: Date.now()
              });
          }
      });
      await Promise.all(promises);

      // 3. Save Updated Record
      const updatedRecord: PropertyRecord = {
          ...record,
          analysis: {
              ...analysis,
              distress_score: newDistress,
              tier_label: newTier,
              scorecard: editedScorecard
          }
      };

      await saveRecord(updatedRecord);
      setRecord(updatedRecord);
      setIsEditing(false);
  };

  // Scorecard Item Component
  const ScoreItem = ({ label, itemKey, data }: { label: string, itemKey: keyof Scorecard, data: CategoryScore }) => {
      // Guard against missing data (e.g. old records before this field existed)
      if (!data) return null;
      
      const isNull = data.score === null || data.score === undefined;
      
      // Color coding for score
      let scoreColor = "text-slate-400"; // Null/NA
      if (!isNull) {
          if (data.score! >= 7) scoreColor = "text-red-600";
          else if (data.score! >= 4) scoreColor = "text-orange-500";
          else scoreColor = "text-green-600";
      }

      if (isEditing) {
          return (
            <div className="flex flex-col p-3 bg-white rounded-lg border-2 border-blue-100 shadow-sm relative">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold uppercase text-blue-800 tracking-wider">{label}</span>
                    <input 
                        type="number" 
                        min="0" max="10" step="0.5"
                        placeholder="N/A"
                        value={isNull ? "" : data.score!}
                        onChange={(e) => handleScoreChange(itemKey, e.target.value)}
                        className="w-16 text-right font-bold border border-slate-300 rounded px-1 py-0.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                </div>
                <textarea 
                    value={data.observation}
                    onChange={(e) => handleObsChange(itemKey, e.target.value)}
                    className="text-xs text-slate-700 leading-snug border border-slate-200 rounded p-1 w-full h-20 resize-none focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <div className="absolute top-1 right-20 text-[10px] text-slate-400 pointer-events-none">
                    Empty = N/A
                </div>
            </div>
          );
      }

      return (
        <div className="flex flex-col p-3 bg-white rounded-lg border border-slate-100 shadow-sm hover:border-blue-200 transition-colors h-full">
            <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold uppercase text-slate-500 tracking-wider">{label}</span>
                <span className={`text-sm font-black ${scoreColor}`}>
                    {isNull ? "N/A" : data.score}
                </span>
            </div>
            <p className="text-xs text-slate-700 leading-snug">{data.observation}</p>
        </div>
      );
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
           <button onClick={onClose} className="text-slate-500 hover:text-slate-800 text-sm font-medium flex items-center mb-1">
             <ChevronLeft size={16} /> Back to Dashboard
           </button>
           <h1 className="text-2xl font-bold text-slate-900">{record.address}</h1>
           <div className="flex items-center gap-2 text-sm text-slate-500 mt-1">
              <Calendar size={14} />
              <span>Scanned: {new Date(record.timestamp).toLocaleDateString()}</span>
           </div>
        </div>
        
        <div className="flex items-center gap-3">
            {isEditing ? (
                <>
                    <button 
                        onClick={() => setIsEditing(false)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 text-sm font-medium"
                    >
                        <X size={16} /> Cancel
                    </button>
                    <button 
                        onClick={saveCorrections}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-white bg-green-600 hover:bg-green-700 shadow-sm text-sm font-medium"
                    >
                        <Save size={16} /> Save & Train
                    </button>
                </>
            ) : (
                <button 
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 shadow-sm text-sm font-medium"
                >
                    <Edit3 size={16} /> Correct Analysis
                </button>
            )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Visuals & Score */}
        <div className="space-y-6">
            
            {/* Score Card */}
            <div className={`rounded-xl p-6 border-2 ${tierBg} flex items-center justify-between shadow-sm relative overflow-hidden`}>
                <div className="relative z-10">
                    <div className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-1">Distress Score</div>
                    <div className={`text-4xl font-black ${tierColor}`}>{analysis.distress_score}</div>
                    <div className={`text-sm font-bold mt-1 ${tierColor}`}>{analysis.tier_label}</div>
                    {isEditing && (
                        <div className="text-[10px] text-slate-500 mt-2 italic">
                            *Score will auto-recalculate on save
                        </div>
                    )}
                </div>
                <div className="h-24 w-24">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={gaugeData}
                                cx="50%"
                                cy="50%"
                                innerRadius={25}
                                outerRadius={40}
                                startAngle={180}
                                endAngle={0}
                                paddingAngle={0}
                                dataKey="value"
                            >
                                {gaugeData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={gaugeColors[index % gaugeColors.length]} stroke="none" />
                                ))}
                            </Pie>
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Image Gallery */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="relative aspect-video bg-slate-100 group">
                    {record.images[selectedImageIdx] ? (
                        <img 
                            src={record.images[selectedImageIdx].data} 
                            alt="Property" 
                            className="w-full h-full object-contain"
                            onClick={() => setIsFullscreen(true)}
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full text-slate-400">No Image</div>
                    )}
                    
                    {/* Navigation Overlays */}
                    <div className="absolute inset-0 flex items-center justify-between p-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                         <button onClick={(e) => {e.stopPropagation(); prevImage();}} className="pointer-events-auto bg-black/50 text-white p-2 rounded-full hover:bg-black/70">
                             <ChevronLeft size={20} />
                         </button>
                         <button onClick={(e) => {e.stopPropagation(); nextImage();}} className="pointer-events-auto bg-black/50 text-white p-2 rounded-full hover:bg-black/70">
                             <ChevronRight size={20} />
                         </button>
                    </div>

                    <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setIsFullscreen(true)} className="bg-black/50 text-white p-1.5 rounded-lg hover:bg-black/70">
                            <Maximize2 size={16} />
                        </button>
                    </div>

                    <div className="absolute top-3 left-3 bg-black/60 text-white px-2 py-1 rounded text-xs font-medium backdrop-blur-sm">
                        {record.images[selectedImageIdx]?.label}
                    </div>
                </div>
                
                {/* Thumbnails */}
                <div className="flex gap-2 p-3 overflow-x-auto bg-slate-50 border-t border-slate-200">
                    {record.images.map((img, idx) => (
                        <button 
                            key={idx}
                            onClick={() => setSelectedImageIdx(idx)}
                            className={`relative w-16 h-12 flex-shrink-0 rounded overflow-hidden border-2 transition-all ${selectedImageIdx === idx ? 'border-blue-500 ring-1 ring-blue-500' : 'border-transparent opacity-60 hover:opacity-100'}`}
                        >
                            <img src={img.data} className="w-full h-full object-cover" alt="thumb" />
                        </button>
                    ))}
                </div>
            </div>

            {/* Metadata & Visibility Info */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                    <Info size={16} className="text-blue-500" />
                    Metadata & Visibility
                </h3>
                
                <div className="space-y-3 text-sm">
                    <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-500">Visibility Score</span>
                        <div className="flex items-center gap-1 font-medium">
                            {visibility.overall_score}/10
                            {visibility.overall_score < 4 ? <EyeOff size={14} className="text-red-500" /> : <Eye size={14} className="text-green-500" />}
                        </div>
                    </div>
                     <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-500">Street View Date</span>
                        <span className="font-medium text-slate-800">{metadata.streetview_date || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-500">Aerial Available</span>
                        <span className={`font-medium ${metadata.aerial_available ? 'text-green-600' : 'text-slate-400'}`}>
                            {metadata.aerial_available ? 'Yes' : 'No'}
                        </span>
                    </div>
                    {visibility.hallucination_warning && (
                        <div className="bg-orange-50 text-orange-800 p-2 rounded text-xs mt-2 flex gap-2 items-start">
                            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                            <span>
                                <strong>Warning:</strong> Low visibility or privacy blur detected. AI instructed not to hallucinate features.
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>

        {/* Right Column: Scorecard Grid */}
        <div className="lg:col-span-2 space-y-6">
            
            {/* Top Level Summary */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <h3 className="text-xs font-bold text-slate-400 uppercase mb-1">Investment Summary</h3>
                        <p className="text-sm text-slate-700 leading-relaxed">{analysis.investment_summary}</p>
                    </div>
                    <div>
                        <h3 className="text-xs font-bold text-slate-400 uppercase mb-1">Primary Red Flags</h3>
                        <div className="flex flex-wrap gap-2">
                            {analysis.primary_red_flags.length > 0 ? analysis.primary_red_flags.map((flag, i) => (
                                <span key={i} className="inline-flex items-center px-2 py-1 rounded bg-red-50 text-red-700 text-xs font-semibold border border-red-100">
                                    <AlertOctagon size={12} className="mr-1" />
                                    {flag}
                                </span>
                            )) : <span className="text-sm text-slate-500 italic">None detected.</span>}
                        </div>
                    </div>
                </div>
            </div>

            {/* Detailed Scorecard Grid */}
            <div>
                 <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Hammer size={18} className="text-slate-400" />
                        Master Scorecard
                    </h3>
                    {isEditing && (
                        <span className="text-xs text-blue-600 font-medium bg-blue-50 px-2 py-1 rounded animate-pulse">
                            Editing Mode Active
                        </span>
                    )}
                 </div>
                 
                 <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                     {/* Pass correct data depending on mode */}
                     <ScoreItem label="Roof Condition" itemKey="roof" data={isEditing ? editedScorecard.roof : analysis.scorecard.roof} />
                     <ScoreItem label="Facade / Stucco" itemKey="facade_condition" data={isEditing ? editedScorecard.facade_condition : analysis.scorecard.facade_condition} />
                     <ScoreItem label="Windows" itemKey="windows" data={isEditing ? editedScorecard.windows : analysis.scorecard.windows} />
                     <ScoreItem label="Doors" itemKey="doors" data={isEditing ? editedScorecard.doors : analysis.scorecard.doors} />
                     
                     <ScoreItem label="Fascia / Soffits" itemKey="fascia" data={isEditing ? editedScorecard.fascia : analysis.scorecard.fascia} />
                     <ScoreItem label="Exterior Paint" itemKey="paint" data={isEditing ? editedScorecard.paint : analysis.scorecard.paint} />
                     <ScoreItem label="Landscaping" itemKey="landscaping" data={isEditing ? editedScorecard.landscaping : analysis.scorecard.landscaping} />

                     <ScoreItem label="Debris / Clutter" itemKey="debris" data={isEditing ? editedScorecard.debris : analysis.scorecard.debris} />
                     <ScoreItem label="Fence" itemKey="fence" data={isEditing ? editedScorecard.fence : analysis.scorecard.fence} />
                     <ScoreItem label="Driveway" itemKey="driveway" data={isEditing ? editedScorecard.driveway : analysis.scorecard.driveway} />
                     
                     <ScoreItem label="Pool" itemKey="pool" data={isEditing ? editedScorecard.pool : analysis.scorecard.pool} />
                     <ScoreItem label="House Number" itemKey="house_number" data={isEditing ? editedScorecard.house_number : analysis.scorecard.house_number} />
                     <ScoreItem label="Vegetation Inv." itemKey="vegetation" data={isEditing ? editedScorecard.vegetation : analysis.scorecard.vegetation} />
                 </div>
            </div>

            {/* Structural & Mechanical */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
                    <h4 className="text-sm font-bold text-slate-800 mb-2">Structural Observations</h4>
                    <p className="text-xs text-slate-600 leading-relaxed">{analysis.structural_observations}</p>
                 </div>
                 <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
                    <h4 className="text-sm font-bold text-slate-800 mb-2">Mechanical / HVAC Signs</h4>
                    <p className="text-xs text-slate-600 leading-relaxed">{analysis.mechanical_status}</p>
                 </div>
            </div>

        </div>
      </div>

      {/* Fullscreen Modal */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-fade-in select-none">
            {/* Close Button */}
            <button 
                onClick={() => setIsFullscreen(false)}
                className="absolute top-4 right-4 text-white bg-white/10 p-2 rounded-full hover:bg-white/20 z-50 transition-all"
            >
                <X size={24} />
            </button>
            
            {/* Left Nav */}
            <button 
                onClick={(e) => { e.stopPropagation(); prevImage(); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white bg-white/10 p-3 rounded-full hover:bg-white/20 transition-all hover:scale-110 z-50"
            >
                <ChevronLeft size={32} />
            </button>

            {/* Right Nav */}
            <button 
                onClick={(e) => { e.stopPropagation(); nextImage(); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white bg-white/10 p-3 rounded-full hover:bg-white/20 transition-all hover:scale-110 z-50"
            >
                <ChevronRight size={32} />
            </button>

            <img 
                src={record.images[selectedImageIdx].data} 
                alt="Fullscreen" 
                className="max-w-full max-h-[85vh] object-contain shadow-2xl"
            />
            
            <div className="absolute bottom-8 bg-black/50 backdrop-blur-md px-6 py-2 rounded-full text-white/90 font-medium text-lg flex items-center gap-3">
                <span>{record.images[selectedImageIdx].label}</span>
                <span className="text-white/50 text-sm border-l border-white/20 pl-3">
                    {selectedImageIdx + 1} / {record.images.length}
                </span>
            </div>
        </div>
      )}
    </div>
  );
};

export default ResultView;
