import WebSocket from 'ws';
import type {WebSocketLikeConstructor} from '@supabase/supabase-js';
// Supabase supports ws on Node 20; ws and DOM declarations use different event types.
// Auth does not open Realtime channels, but the SDK still initializes its transport.
export const authTransport=WebSocket as unknown as WebSocketLikeConstructor;
