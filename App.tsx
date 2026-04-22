
import React, { useState, useEffect } from 'react';
import { ViewState, PropertyRecord } from './types';
import Dashboard from './components/Dashboard';
import AnalysisView from './components/AnalysisView';
import ResultView from './components/ResultView';
import { LayoutDashboard, PlusCircle, Sun } from 'lucide-react';
import { initDB, getAllRecords } from './services/db';

const App: React.FC = () => {
  const [view, setView] = useState<ViewState>(ViewState.DASHBOARD);
  const [records, setRecords] = useState<PropertyRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<PropertyRecord | null>(null);

  useEffect(() => {
    // Initialize DB and load records
    const setup = async () => {
        try {
            await initDB();
            const savedRecords = await getAllRecords();
            setRecords(savedRecords);
        } catch (e) {
            console.error("Failed to load records from DB", e);
        }
    };
    setup();
  }, []);

  const handleAnalysisComplete = (newRecord: PropertyRecord) => {
    setRecords(prev => [newRecord, ...prev]);
    setSelectedRecord(newRecord);
    setView(ViewState.DASHBOARD);
  };

  const renderContent = () => {
    if (selectedRecord) {
        return (
            <ResultView 
                record={selectedRecord} 
                onClose={() => setSelectedRecord(null)} 
            />
        );
    }

    switch (view) {
      case ViewState.ANALYZE:
        return (
          <AnalysisView 
            onAnalysisComplete={handleAnalysisComplete}
            onCancel={() => setView(ViewState.DASHBOARD)}
          />
        );
      case ViewState.DASHBOARD:
      default:
        return (
          <Dashboard 
            records={records} 
            onAnalyzeNew={() => setView(ViewState.ANALYZE)}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Navbar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => { setSelectedRecord(null); setView(ViewState.DASHBOARD); }}>
            <div className="bg-gradient-to-tr from-blue-600 to-indigo-500 p-2 rounded-lg text-white">
                <Sun size={20} />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-800">
              Sunshine<span className="text-blue-600">Scout</span>
            </span>
          </div>
          
          <nav className="flex items-center gap-4">
             {!selectedRecord && view !== ViewState.ANALYZE && (
                 <button 
                    onClick={() => setView(ViewState.ANALYZE)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
                >
                    <PlusCircle size={16} />
                    New Scan
                 </button>
             )}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {renderContent()}
      </main>
      
      {/* Footer */}
      <footer className="border-t border-slate-200 py-8 mt-8">
          <div className="max-w-7xl mx-auto px-4 text-center text-slate-400 text-sm">
              <p>Florida Real Estate Distress Analyzer • Powered by Gemini Vision</p>
          </div>
      </footer>
    </div>
  );
};

export default App;
