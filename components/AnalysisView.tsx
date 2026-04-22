
import React, { useState, useRef } from 'react';
import { Upload, X, Loader2, AlertCircle, Camera, CheckCircle, MapPin, Layers, Search, ArrowRight, Scan } from 'lucide-react';
import { analyzePropertyImages, fileToDataUri, assessVisibility } from '../services/geminiService';
import { getPropertyImages } from '../services/mapService';
import { PropertyRecord, VisibilityAssessment, PropertyMetadata } from '../types';
import { saveRecord } from '../services/db';

interface AnalysisViewProps {
  onAnalysisComplete: (record: PropertyRecord) => void;
  onCancel: () => void;
}

type InputMode = 'UPLOAD' | 'SEARCH';

const AnalysisView: React.FC<AnalysisViewProps> = ({ onAnalysisComplete, onCancel }) => {
  const [mode, setMode] = useState<InputMode>('SEARCH');
  
  // Manual Upload State
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [manualAddress, setManualAddress] = useState('');

  // Batch Search State
  const [batchInput, setBatchInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; currentAddress?: string } | null>(null);
  const [failedItems, setFailedItems] = useState<{ address: string; reason: string }[]>([]);

  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Manual Upload Handlers ---
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setImages(prev => [...prev, ...newFiles]);
      const newPreviews = await Promise.all(newFiles.map(fileToDataUri));
      setPreviews(prev => [...prev, ...newPreviews]);
    }
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
    setPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleManualAnalyze = async () => {
    if (images.length === 0) {
      setError("Please upload at least one image (Street View or Aerial).");
      return;
    }
    if (!manualAddress.trim()) {
        setError("Please enter a reference address or ID.");
        return;
    }
    // Manual analysis defaults
    const defaultMeta: PropertyMetadata = { 
        streetview_available: true, 
        streetview_date: new Date().toISOString().split('T')[0],
        streetview_year: new Date().getFullYear(),
        aerial_available: false,
        aerial_date: null
    };
    runSingleAnalysis(manualAddress, images, defaultMeta, false);
  };

  // --- Batch Process Handlers ---
  const handleBatchAnalyze = async () => {
    const addresses = batchInput.split('\n').map(a => a.trim()).filter(a => a.length > 0);
    if (addresses.length === 0) {
        setError("Please enter at least one address.");
        return;
    }

    setIsProcessing(true);
    setError(null);
    setFailedItems([]);
    setProgress({ current: 0, total: addresses.length });

    // Process sequentially to avoid rate limits and ensuring ordered state updates
    for (let i = 0; i < addresses.length; i++) {
        const address = addresses[i];
        setProgress({ current: i + 1, total: addresses.length, currentAddress: address });

        try {
            // 1. Fetch Images from Google Maps
            const result = await getPropertyImages(address);
            
            // 2. Analyze with Gemini
            await runSingleAnalysis(address, result.files, result.metadata, true);

        } catch (err: any) {
            console.error(`Failed to process ${address}:`, err);
            setFailedItems(prev => [...prev, { address, reason: err.message || "Unknown error" }]);
        }
        
        // Small delay to be nice to APIs
        await new Promise(r => setTimeout(r, 1000));
    }

    setIsProcessing(false);
    setProgress(null);
  };

  const formatLabel = (filename: string) => {
    return filename
      .replace(/\.[^/.]+$/, "") // Remove extension
      .replace(/_/g, " ")       // Replace underscores with spaces
      .replace(/\b\w/g, (l) => l.toUpperCase()) // Title Case
      .replace("Verified", "") // Clean up system tags
      .trim();
  };

  const runSingleAnalysis = async (
      address: string, 
      files: File[], 
      metadata: PropertyMetadata, 
      keepActive = false
    ) => {
    // If not batch (keepActive=false), set processing/error states locally
    if (!keepActive) {
        setIsProcessing(true);
        setError(null);
    }

    try {
      // 0. Pre-Check Visibility (Anti-Hallucination)
      // Robustly find a street view image. 
      // Prioritize "Master" -> "Facade" -> Any Non-Aerial -> Fallback to first file.
      const streetFile = files.find(f => f.name.includes("front_center_master")) || 
                         files.find(f => f.name.includes("facade")) || 
                         files.find(f => !f.name.toLowerCase().includes("aerial")) || 
                         files[0];

      // Robustly find an aerial image.
      const aerialFile = files.find(f => f.name.toLowerCase().includes("aerial")) || 
                         files.find(f => f !== streetFile) || 
                         files[0];
      
      let visibilityAnalysis: VisibilityAssessment;
      const dateForVis = metadata.streetview_date || "Unknown";

      if (streetFile) {
          // If the chosen street file is actually an aerial (because nothing else existed), 
          // assessVisibility handles that case internally and zeros the score.
          visibilityAnalysis = await assessVisibility(streetFile, aerialFile || streetFile, dateForVis);
      } else {
          // Fallback if we don't have good inputs
           visibilityAnalysis = {
              overall_score: 5,
              capture_date: dateForVis,
              setback_distance: "Medium Setback",
              is_blurred: false,
              obstructions: ["Incomplete Input Data"],
              hallucination_warning: true
           };
      }

      const result = await analyzePropertyImages(files, visibilityAnalysis);
      
      const annotatedImages = await Promise.all(files.map(async (file) => ({
        data: await fileToDataUri(file),
        label: formatLabel(file.name)
      })));
      
      const record: PropertyRecord = {
        id: crypto.randomUUID(),
        address: address,
        timestamp: Date.now(),
        images: annotatedImages,
        analysis: result,
        metadata: metadata
      };

      // Save to IndexedDB
      await saveRecord(record);

      onAnalysisComplete(record);
    } catch (err: any) {
        console.error(err);
        if (!keepActive) setError(err.message || "An unexpected error occurred.");
        else throw err; // Re-throw for batch handler to catch
    } finally {
      if (!keepActive) setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
                <button onClick={onCancel} className="text-slate-500 hover:text-slate-700 text-sm font-medium flex items-center mb-2">
                    ← Back to Dashboard
                </button>
                <h2 className="text-2xl font-bold text-slate-800">New Property Analysis</h2>
                <p className="text-slate-500 text-sm">Detect distress signals using Gemini Vision.</p>
            </div>
            
            {/* Mode Toggle */}
            <div className="bg-slate-200 p-1 rounded-lg inline-flex">
                <button 
                    onClick={() => !isProcessing && setMode('SEARCH')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${mode === 'SEARCH' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
                >
                    <Search size={16} />
                    Address Search
                </button>
                <button 
                    onClick={() => !isProcessing && setMode('UPLOAD')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${mode === 'UPLOAD' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
                >
                    <Upload size={16} />
                    Manual Upload
                </button>
            </div>
        </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Input Section */}
        <div className="lg:col-span-2 space-y-6">
            
            {mode === 'SEARCH' ? (
                // --- Batch Search Mode ---
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-full flex flex-col">
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        Target Addresses (One per line)
                    </label>
                    <textarea 
                        value={batchInput}
                        onChange={(e) => setBatchInput(e.target.value)}
                        placeholder={"123 Palm Ave, Miami, FL\n456 Ocean Dr, Fort Lauderdale, FL"}
                        className="flex-1 min-h-[200px] w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm leading-relaxed resize-none"
                        disabled={isProcessing}
                    />
                    <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                        <span>We will auto-fetch: Straight-on, Multi-angle sweep, and Aerial.</span>
                        <span>{batchInput ? batchInput.split('\n').filter(l=>l.trim()).length : 0} properties</span>
                    </div>

                    {isProcessing && progress && (
                        <div className="mt-4 bg-blue-50 rounded-lg p-4 border border-blue-100">
                            <div className="flex justify-between text-sm font-bold text-blue-800 mb-2">
                                <span>Analyzing Properties...</span>
                                <span>{progress.current} / {progress.total}</span>
                            </div>
                            <div className="w-full bg-blue-200 rounded-full h-2 mb-2">
                                <div 
                                    className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                                ></div>
                            </div>
                            <div className="text-xs text-blue-600 truncate">
                                Currently scanning: {progress.currentAddress}
                            </div>
                        </div>
                    )}
                    
                    {failedItems.length > 0 && (
                        <div className="mt-4 bg-red-50 rounded-lg p-4 border border-red-100">
                            <h4 className="text-sm font-bold text-red-800 mb-2">Failed Items</h4>
                            <ul className="space-y-2">
                                {failedItems.map((item, idx) => (
                                    <li key={idx} className="text-xs text-red-700 flex flex-col gap-1 bg-white/50 p-2 rounded border border-red-100">
                                        <span className="font-semibold text-red-800">{item.address}</span>
                                        <span className="leading-tight">{item.reason}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <button 
                        onClick={handleBatchAnalyze}
                        disabled={isProcessing || !batchInput.trim()}
                        className={`mt-6 w-full py-3 rounded-xl font-bold text-white shadow-md transition-all flex items-center justify-center gap-2 ${
                            isProcessing || !batchInput.trim() ? 'bg-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'
                        }`}
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 className="animate-spin" size={20} />
                                Processing Batch...
                            </>
                        ) : (
                            <>
                                <Layers size={20} />
                                Run Batch Analysis
                            </>
                        )}
                    </button>
                </div>
            ) : (
                // --- Manual Upload Mode ---
                <>
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <label className="block text-sm font-medium text-slate-700 mb-2">Property Address / ID</label>
                        <input 
                            type="text" 
                            value={manualAddress}
                            onChange={(e) => setManualAddress(e.target.value)}
                            placeholder="e.g. 1234 Palm Ave, Miami, FL"
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                        />
                    </div>

                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <div className="flex justify-between items-center mb-4">
                            <label className="block text-sm font-medium text-slate-700">Property Imagery</label>
                            <button 
                                onClick={() => fileInputRef.current?.click()}
                                className="text-sm text-blue-600 font-medium hover:text-blue-800"
                            >
                                + Add Images
                            </button>
                        </div>
                    
                        <input 
                            type="file" 
                            ref={fileInputRef}
                            onChange={handleFileSelect}
                            className="hidden" 
                            multiple 
                            accept="image/*"
                        />

                        {previews.length === 0 ? (
                            <div 
                                onClick={() => fileInputRef.current?.click()}
                                className="border-2 border-dashed border-slate-300 rounded-lg h-48 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 transition-colors"
                            >
                                <div className="bg-blue-50 p-3 rounded-full mb-3">
                                    <Upload className="text-blue-500" size={24} />
                                </div>
                                <p className="text-slate-600 font-medium">Click to upload or drag and drop</p>
                                <p className="text-xs text-slate-400 mt-1">PNG, JPG up to 10MB</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                {previews.map((src, idx) => (
                                    <div key={idx} className="relative group rounded-lg overflow-hidden border border-slate-200 aspect-video">
                                        <img src={src} alt={`Preview ${idx}`} className="w-full h-full object-cover" />
                                        <button 
                                            onClick={() => removeImage(idx)}
                                            className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))}
                                <div 
                                    onClick={() => fileInputRef.current?.click()}
                                    className="border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center cursor-pointer hover:bg-slate-50 transition-colors aspect-video"
                                >
                                    <span className="text-slate-400 text-sm font-medium">+ Add More</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <button 
                        onClick={handleManualAnalyze}
                        disabled={isProcessing}
                        className={`w-full py-3 rounded-xl font-bold text-white shadow-md transition-all flex items-center justify-center gap-2 ${
                            isProcessing ? 'bg-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'
                        }`}
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 className="animate-spin" size={20} />
                                Analyzing...
                            </>
                        ) : (
                            <>
                                <Camera size={20} />
                                Run Distress Analysis
                            </>
                        )}
                    </button>
                </>
            )}

            {error && (
                <div className="bg-red-50 text-red-700 p-4 rounded-lg flex items-center gap-2 border border-red-100">
                    <AlertCircle size={20} />
                    <span className="text-sm font-medium">{error}</span>
                </div>
            )}
        </div>

        {/* Info Sidebar */}
        <div className="space-y-6">
            <div className="bg-blue-50 p-6 rounded-xl border border-blue-100">
                <h3 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                    <CheckCircle size={18} />
                    Analysis Checklist
                </h3>
                <ul className="space-y-3 text-sm text-blue-800">
                    <li className="flex items-start gap-2">
                        <span className="mt-1 block w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                        <span><strong>Windows:</strong> Boarded up? Broken? Old Jalousie?</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="mt-1 block w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                        <span><strong>Roof:</strong> Tarps? Missing shingles? Sagging?</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="mt-1 block w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                        <span><strong>HVAC:</strong> Window units? Cardboard patches?</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="mt-1 block w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                        <span><strong>Yard:</strong> Overgrown? Debris? Green pool?</span>
                    </li>
                </ul>
            </div>
            
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                <h3 className="font-semibold text-slate-800 mb-2">Automated Data Pull</h3>
                <p className="text-sm text-slate-500 leading-relaxed mb-4">
                    In <strong>Search Mode</strong>, we automatically connect to Google Maps to fetch:
                </p>
                <div className="space-y-2 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                        <MapPin size={14} className="text-blue-500"/>
                        High-Res Front Detail
                    </div>
                    <div className="flex items-center gap-2">
                        <Scan size={14} className="text-blue-500"/>
                        Oblique & Drive-By Views
                    </div>
                    <div className="flex items-center gap-2">
                        <Layers size={14} className="text-blue-500"/>
                        Satellite Aerial View
                    </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default AnalysisView;
