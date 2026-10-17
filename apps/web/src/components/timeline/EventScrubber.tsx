import React from 'react';
import { DecisionEvent } from '../../types';
import { Play, Pause, SkipBack, SkipForward, Clock } from 'lucide-react';

interface ScrubberProps {
  events: DecisionEvent[];
  currentIndex: number;
  onSelectIndex: (index: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
}

export const EventScrubber: React.FC<ScrubberProps> = ({
  events,
  currentIndex,
  onSelectIndex,
  isPlaying,
  onTogglePlay
}) => {
  if (events.length === 0) return null;

  const currentEvent = events[currentIndex] || events[0];

  return (
    <div className="h-12 border-t border-graphite-700 bg-graphite-950/95 backdrop-blur-md px-4 flex items-center justify-between text-xs font-mono select-none z-20">
      {/* Playback Controls */}
      <div className="flex items-center space-x-2">
        <button
          onClick={() => onSelectIndex(0)}
          className="p-1 rounded text-slate-400 hover:text-white transition-colors"
          title="Jump to Start"
        >
          <SkipBack className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onTogglePlay}
          className="p-1.5 rounded bg-graphite-800 hover:bg-slate-700 text-signal-lime transition-colors"
          title={isPlaying ? 'Pause Replay' : 'Play Replay'}
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
        </button>

        <button
          onClick={() => onSelectIndex(events.length - 1)}
          className="p-1 rounded text-slate-400 hover:text-white transition-colors"
          title="Jump to Latest"
        >
          <SkipForward className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center space-x-1.5 text-slate-400 ml-2">
          <Clock className="w-3.5 h-3.5" />
          <span>
            EVENT <span className="text-white font-bold">{currentIndex + 1}</span> / {events.length}
          </span>
        </div>
      </div>

      {/* Scrub Slider */}
      <div className="flex-1 mx-6 flex items-center">
        <input
          type="range"
          min={0}
          max={Math.max(0, events.length - 1)}
          value={currentIndex}
          onChange={(e) => onSelectIndex(parseInt(e.target.value, 10))}
          className="w-full h-1 bg-graphite-800 rounded-lg appearance-none cursor-pointer accent-signal-lime"
        />
      </div>

      {/* Current Event Summary Chip */}
      {currentEvent && (
        <div className="flex items-center space-x-2">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
            currentEvent.decision === 'ALLOW' ? 'bg-signal-lime/20 text-signal-lime' : 'bg-signal-salmon/20 text-signal-salmon'
          }`}>
            {currentEvent.decision}
          </span>
          <span className="text-slate-400 text-[11px] truncate max-w-[150px]">
            {currentEvent.clientIdentifier}
          </span>
        </div>
      )}
    </div>
  );
};
