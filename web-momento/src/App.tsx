import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouteBoundary } from "@/components/ErrorBoundary";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/state/auth";

import { AppShell } from "@/components/layout/AppShell";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import NotFound from "@/pages/NotFound";

import Today from "@/pages/app/Today";
import ProPredictions from "@/pages/app/ProPredictions";
import AppCharts from "@/pages/app/AppCharts";
import Premium from "@/pages/app/Premium";

import CommandCenter from "@/pages/dashboard/CommandCenter";
import AnalysisLab from "@/pages/dashboard/AnalysisLab";
import AccuracyEngine from "@/pages/dashboard/AccuracyEngine";
import MomentumLab from "@/pages/dashboard/MomentumLab";
import Market from "@/pages/dashboard/Market";
import LadderDash from "@/pages/dashboard/LadderDash";
import Resistance from "@/pages/dashboard/Resistance";
import MoonshotFinder from "@/pages/dashboard/MoonshotFinder";
import DnaHunter from "@/pages/dashboard/DnaHunter";
import MegaPressure from "@/pages/dashboard/MegaPressure";
import PatternDna from "@/pages/dashboard/PatternDna";
import ForecastStudio from "@/pages/dashboard/ForecastStudio";
import FullIntelligence from "@/pages/dashboard/FullIntelligence";
import Linguistics from "@/pages/dashboard/Linguistics";
import Vocabulary from "@/pages/dashboard/Vocabulary";
import Investigation from "@/pages/dashboard/Investigation";
import EagleEye from "@/pages/dashboard/EagleEye";
import BirdEye from "@/pages/dashboard/BirdEye";
import Darkboard from "@/pages/dashboard/Darkboard";
import ChartLab from "@/pages/dashboard/ChartLab";
import Scheduler from "@/pages/dashboard/Scheduler";
import RangeLabPage from "@/pages/dashboard/RangeLab";
import CalibrationLab from "@/pages/dashboard/Calibration";
import Ingest from "@/pages/dashboard/Ingest";
import Sources from "@/pages/dashboard/Sources";
import Autopilot from "@/pages/dashboard/Autopilot";
import MomentoFX from "@/pages/dashboard/MomentoFX";
import MomentoFXV2 from "@/pages/dashboard/MomentoFXV2";
import BuildSteps from "@/pages/dashboard/BuildSteps";
import Settings from "@/pages/dashboard/Settings";
import Users from "@/pages/dashboard/Users";
import RoundTesting from "@/pages/dashboard/RoundTesting";
import Downloads from "@/pages/dashboard/Downloads";
import { DocsIndex, DocPage } from "@/pages/dashboard/Docs";

import Orchestrator from "@/pages/Orchestrator";
import Inventory from "@/pages/Inventory";

// React Query is the top-level provider; every other provider nests inside it.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 3000,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider delayDuration={300}>
        <Toaster position="top-right" />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <RouteBoundary label="app">
          <Routes>
            {/* public */}
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />

            {/* everything else lives in the sidebar shell */}
            <Route element={<AppShell />}>
              {/* consumer app */}
              <Route path="/app" element={<Today />} />
              <Route path="/app/pro" element={<ProPredictions />} />
              <Route path="/app/charts" element={<AppCharts />} />
              <Route path="/app/premium" element={<Premium />} />

              {/* operator console */}
              <Route path="/dashboard" element={<CommandCenter />} />
              <Route path="/dashboard/fx-lab" element={<AnalysisLab />} />
              <Route path="/dashboard/accuracy" element={<AccuracyEngine />} />
              <Route path="/dashboard/momentum" element={<MomentumLab />} />
              <Route path="/dashboard/market" element={<Market />} />
              <Route path="/dashboard/ladder" element={<LadderDash />} />
              <Route path="/dashboard/resistance" element={<Resistance />} />
              <Route path="/dashboard/moonshot" element={<MoonshotFinder />} />
              <Route path="/dashboard/dna" element={<DnaHunter />} />
              <Route path="/dashboard/mega-pressure" element={<MegaPressure />} />
              <Route path="/dashboard/pattern-dna" element={<PatternDna />} />
              <Route path="/dashboard/studio" element={<ForecastStudio />} />
              <Route path="/dashboard/intelligence" element={<FullIntelligence />} />
              <Route path="/dashboard/linguistics" element={<Linguistics />} />
              <Route path="/dashboard/vocabulary" element={<Vocabulary />} />
              <Route path="/dashboard/investigation" element={<Investigation />} />
              <Route path="/dashboard/eagle-eye" element={<EagleEye />} />
              <Route path="/dashboard/birdeye" element={<BirdEye />} />
              <Route path="/dashboard/darkboard" element={<Darkboard />} />
              <Route path="/dashboard/chart-lab" element={<ChartLab />} />
              <Route path="/dashboard/scheduler" element={<Scheduler />} />
              <Route path="/dashboard/range-lab" element={<RangeLabPage />} />
              <Route path="/dashboard/calibration" element={<CalibrationLab />} />
              <Route path="/dashboard/ingest" element={<Ingest />} />
              <Route path="/dashboard/sources" element={<Sources />} />
              <Route path="/dashboard/autopilot" element={<Autopilot />} />
              <Route path="/dashboard/momento-fx" element={<MomentoFX />} />
              <Route path="/dashboard/momento-fx-v2" element={<MomentoFXV2 />} />
              <Route path="/dashboard/build-steps" element={<BuildSteps />} />
              <Route path="/dashboard/settings" element={<Settings />} />
              <Route path="/dashboard/users" element={<Users />} />
              <Route path="/dashboard/testing" element={<RoundTesting />} />
              <Route path="/dashboard/downloads" element={<Downloads />} />
              <Route path="/dashboard/docs" element={<DocsIndex />} />
              <Route path="/dashboard/docs/:slug" element={<DocPage />} />

              {/* cross-cutting surfaces */}
              <Route path="/orchestrator" element={<Orchestrator />} />
              <Route path="/inventory" element={<Inventory />} />

              {/* legacy aliases from the previous archives — zero dead links */}
              <Route path="/dashboard/charts" element={<Navigate to="/dashboard/market" replace />} />
              <Route path="/dashboard/crash-studio" element={<Navigate to="/dashboard/studio" replace />} />
              <Route path="/dashboard/login" element={<Navigate to="/login" replace />} />
              <Route path="/dashboard/source" element={<Navigate to="/dashboard/downloads" replace />} />
              <Route path="/app/auth" element={<Navigate to="/login" replace />} />
              <Route path="/auth/callback" element={<Navigate to="/dashboard" replace />} />
              <Route path="/market" element={<Navigate to="/dashboard/market" replace />} />
              <Route path="/ladder-resistance" element={<Navigate to="/dashboard/resistance" replace />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
          </RouteBoundary>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
