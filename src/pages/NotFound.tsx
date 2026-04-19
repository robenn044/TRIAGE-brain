import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import RobotFace from "@/components/RobotFace";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4fbfe] px-6">
      <div className="w-full max-w-md rounded-[2rem] border border-[#20a7db]/10 bg-white p-8 text-center shadow-[0_20px_48px_rgba(32,167,219,0.08)]">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#20a7db]"><RobotFace mini /></div>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#20a7db]">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          The page you opened does not exist. Return to the TRIAGE start screen to begin a new session.
        </p>
        <a href="/" className="mt-5 inline-block rounded-full bg-[#20a7db] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1b96c5]">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
