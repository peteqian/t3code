import { useCallback, useEffect, useState } from "react";

import type { MobilePendingAccessRequest } from "@t3tools/contracts";

import { ensureNativeApi } from "../nativeApi";
import { onServerMobileAccessRequests } from "../wsNativeApi";

export function toMobileAccessErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }
  if (
    error.message.includes("server.listMobileAccessRequests") ||
    error.message.includes("server.approveMobileAccessRequest") ||
    error.message.includes("server.rejectMobileAccessRequest")
  ) {
    return "Mobile access approval requires a server restart.";
  }
  return error.message;
}

export function useMobileAccessRequests() {
  const [pendingRequests, setPendingRequests] = useState<ReadonlyArray<MobilePendingAccessRequest>>(
    [],
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mobileAccessError, setMobileAccessError] = useState<string | null>(null);
  const [approveRequestId, setApproveRequestId] = useState<string | null>(null);
  const [rejectRequestId, setRejectRequestId] = useState<string | null>(null);

  const refreshRequests = useCallback(async () => {
    setIsRefreshing(true);
    setMobileAccessError(null);
    try {
      const api = ensureNativeApi();
      const result = await api.server.listMobileAccessRequests();
      setPendingRequests(result.requests);
    } catch (error) {
      setMobileAccessError(
        toMobileAccessErrorMessage(error, "Unable to load pending mobile access requests."),
      );
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const approveRequest = useCallback(async (requestId: string) => {
    setApproveRequestId(requestId);
    setMobileAccessError(null);
    try {
      const api = ensureNativeApi();
      await api.server.approveMobileAccessRequest({ requestId });
      setPendingRequests((current) => current.filter((request) => request.requestId !== requestId));
    } catch (error) {
      setMobileAccessError(
        toMobileAccessErrorMessage(error, "Unable to approve mobile access request."),
      );
    } finally {
      setApproveRequestId(null);
    }
  }, []);

  const rejectRequest = useCallback(async (requestId: string) => {
    setRejectRequestId(requestId);
    setMobileAccessError(null);
    try {
      const api = ensureNativeApi();
      await api.server.rejectMobileAccessRequest({ requestId });
      setPendingRequests((current) => current.filter((request) => request.requestId !== requestId));
    } catch (error) {
      setMobileAccessError(
        toMobileAccessErrorMessage(error, "Unable to reject mobile access request."),
      );
    } finally {
      setRejectRequestId(null);
    }
  }, []);

  useEffect(() => {
    void refreshRequests();
    return onServerMobileAccessRequests((payload) => {
      setPendingRequests(payload.requests);
      setMobileAccessError(null);
    });
  }, [refreshRequests]);

  return {
    pendingRequests,
    isRefreshing,
    mobileAccessError,
    approveRequestId,
    rejectRequestId,
    refreshRequests,
    approveRequest,
    rejectRequest,
  };
}
