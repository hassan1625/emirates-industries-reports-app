// Starts the browser download of a finished report: asks the app for a
// short-lived signed link, then follows it. A plain <a href> cannot be used
// directly because the embedded app's session token is not sent on navigation.
import { useCallback, useState } from "react";

export function useReportDownload() {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const download = useCallback(async (jobId) => {
    setBusyId(jobId);
    setError(null);
    try {
      const response = await fetch(`/app/report-download-link/${encodeURIComponent(jobId)}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(response.status === 409 ? "The report is not ready yet." : "Could not prepare the download. Please try again.");
      const { url } = await response.json();
      const link = document.createElement("a");
      link.href = url;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusyId(null);
    }
  }, []);

  return { download, busyId, error };
}
