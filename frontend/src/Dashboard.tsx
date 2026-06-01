import React from 'react';

const Dashboard = () => {
  const tasks = [
    { id: 1, name: 'Adobe Acrobat Update Task', platform: 'Windows', status: 'Ready', lastRun: '2026-06-01 09:00', path: '\\Adobe Acrobat Update Task' },
    { id: 2, name: 'AMDAutoUpdate', platform: 'Windows', status: 'Ready', lastRun: '2026-06-01 08:30', path: '\\AMDAutoUpdate' },
    { id: 3, name: 'Backup Database', platform: 'Claude', status: 'Running', lastRun: '2026-06-01 10:00', path: 'backup_db_routine' },
    { id: 4, name: 'Clean Temp Files', platform: 'Windows', status: 'Disabled', lastRun: '2026-05-31 23:00', path: '\\CleanTemp' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 p-6 font-sans">
      <header className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">TaskHub</h1>
          <p className="text-slate-400">Control Plane for Scheduled Tasks</p>
        </div>
        <div className="flex gap-4">
          <button className="bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-md text-sm transition-colors border border-slate-700">
            Connect Platform
          </button>
          <button className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-md text-sm font-semibold transition-colors">
            Trigger All
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {tasks.map((task) => (
          <div key={task.id} className="bg-slate-900 border border-slate-800 rounded-lg p-4 hover:border-slate-700 transition-all shadow-xl group">
            <div className="flex justify-between items-start mb-3">
              <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                task.platform === 'Windows' ? 'bg-blue-900/40 text-blue-400 border border-blue-800' : 'bg-purple-900/40 text-purple-400 border border-purple-800'
              }`}>
                {task.platform}
              </span>
              <span className={`h-2 w-2 rounded-full ${
                task.status === 'Running' ? 'bg-green-500 animate-pulse' : 
                task.status === 'Ready' ? 'bg-blue-500' : 'bg-slate-600'
              }`}></span>
            </div>
            
            <h3 className="font-semibold text-lg mb-1 truncate group-hover:text-blue-400 transition-colors">{task.name}</h3>
            <code className="text-[10px] text-slate-500 block mb-4 truncate bg-slate-950 p-1 rounded border border-slate-800">{task.path}</code>
            
            <div className="flex justify-between items-center text-xs text-slate-400 mb-4">
              <span>Status: <span className="text-slate-200">{task.status}</span></span>
              <span>Last: {task.lastRun.split(' ')[1]}</span>
            </div>

            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button className="flex-1 bg-slate-800 hover:bg-slate-700 text-xs py-2 rounded border border-slate-700">
                Log
              </button>
              <button className="flex-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs py-2 rounded border border-blue-900/50 font-bold">
                Run Now
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Dashboard;
