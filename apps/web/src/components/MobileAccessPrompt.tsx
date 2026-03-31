import { useNavigate } from "@tanstack/react-router";

import { useMobileAccessRequests } from "../hooks/useMobileAccessRequests";
import { Button } from "./ui/button";

export function MobileAccessPrompt() {
  const navigate = useNavigate();
  const { pendingRequests, approveRequestId, rejectRequestId, approveRequest, rejectRequest } =
    useMobileAccessRequests();

  const nextRequest = pendingRequests[0];
  if (!nextRequest) {
    return null;
  }

  const extraCount = Math.max(0, pendingRequests.length - 1);

  return (
    <div className="pointer-events-none fixed top-4 right-4 z-50 w-[min(28rem,calc(100vw-2rem))]">
      <div className="pointer-events-auto rounded-xl border border-border bg-card/95 p-4 shadow-2xl backdrop-blur">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Mobile access request
        </p>
        <p className="mt-2 text-sm font-medium text-foreground">
          {nextRequest.deviceName} wants to connect.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Expires {new Date(nextRequest.expiresAt).toLocaleTimeString()}
          {extraCount > 0 ? ` · ${extraCount} more waiting` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => void approveRequest(nextRequest.requestId)}
            disabled={approveRequestId === nextRequest.requestId}
          >
            {approveRequestId === nextRequest.requestId ? "Approving..." : "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void rejectRequest(nextRequest.requestId)}
            disabled={rejectRequestId === nextRequest.requestId}
          >
            {rejectRequestId === nextRequest.requestId ? "Rejecting..." : "Reject"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void navigate({ to: "/settings" })}>
            Open settings
          </Button>
        </div>
      </div>
    </div>
  );
}
