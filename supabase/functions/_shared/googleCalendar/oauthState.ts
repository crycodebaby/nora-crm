import { supabaseAdmin } from "../supabaseAdmin.ts";
import { createPkcePair, randomOAuthState, sha256Hex } from "./pkce.ts";

const STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthStateConsumeResult = {
  userId: string;
  pkceVerifier: string;
};

export const createOAuthState = async (
  userId: string,
): Promise<{ state: string; pkceChallenge: string }> => {
  const state = randomOAuthState();
  const stateHash = await sha256Hex(state);
  const { verifier, challenge } = await createPkcePair();
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();

  const { error } = await supabaseAdmin.rpc("store_google_oauth_state", {
    p_user_id: userId,
    p_state_hash: stateHash,
    p_expires_at: expiresAt,
    p_pkce_verifier: verifier,
  });

  if (error) {
    throw error;
  }

  return { state, pkceChallenge: challenge };
};

export const consumeOAuthState = async (
  state: string,
): Promise<OAuthStateConsumeResult | null> => {
  const stateHash = await sha256Hex(state);

  const { data, error } = await supabaseAdmin.rpc("consume_google_oauth_state", {
    p_state_hash: stateHash,
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.user_id || !row?.pkce_verifier) {
    return null;
  }

  return {
    userId: row.user_id as string,
    pkceVerifier: row.pkce_verifier as string,
  };
};
