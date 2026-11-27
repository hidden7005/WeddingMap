// Supabase에서 자동 생성한 DB 타입 (WeddingMap 프로젝트).
// 스키마를 바꾸면 다시 생성: npx supabase gen types typescript --project-id ihdubijsbwrbudrjxaxk > src/lib/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      edits: {
        Row: {
          action: string
          created_at: string
          field: string | null
          id: number
          new_value: Json | null
          old_value: Json | null
          record_id: string
          table_name: string
          user_id: string | null
          venue_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          field?: string | null
          id?: never
          new_value?: Json | null
          old_value?: Json | null
          record_id: string
          table_name: string
          user_id?: string | null
          venue_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          field?: string | null
          id?: never
          new_value?: Json | null
          old_value?: Json | null
          record_id?: string
          table_name?: string
          user_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "edits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edits_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      hall_schedules: {
        Row: {
          created_at: string
          day_type: string
          hall_id: string
          id: string
          start_time: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          day_type?: string
          hall_id: string
          id?: string
          start_time: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          day_type?: string
          hall_id?: string
          id?: string
          start_time?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hall_schedules_hall_id_fkey"
            columns: ["hall_id"]
            isOneToOne: false
            referencedRelation: "halls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hall_schedules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      halls: {
        Row: {
          checked_at: string
          created_at: string
          floor: string | null
          hall_type: string | null
          id: string
          interval_minutes: number | null
          is_outdoor: boolean
          name: string
          sort_order: number
          updated_at: string
          updated_by: string | null
          venue_id: string
        }
        Insert: {
          checked_at?: string
          created_at?: string
          floor?: string | null
          hall_type?: string | null
          id?: string
          interval_minutes?: number | null
          is_outdoor?: boolean
          name: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          venue_id: string
        }
        Update: {
          checked_at?: string
          created_at?: string
          floor?: string | null
          hall_type?: string | null
          id?: string
          interval_minutes?: number | null
          is_outdoor?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "halls_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "halls_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      login_events: {
        Row: {
          created_at: string
          device: string | null
          id: number
          method: string | null
          replaced_other: boolean
          session_id: string
          user_agent: string | null
          user_id: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      members: {
        Row: {
          approved_at: string | null
          created_at: string
          email: string | null
          id: string
          joined_at: string | null
          member_code: string | null
          name: string
          note: string | null
          team: string | null
          role: string
          status: string
          user_id: string | null
        }
        Insert: {
          approved_at?: string | null
          created_at?: string
          email?: string | null
          id?: string
          joined_at?: string | null
          member_code?: string | null
          name: string
          note?: string | null
          team?: string | null
          role?: string
          status?: string
          user_id?: string | null
        }
        Update: {
          approved_at?: string | null
          created_at?: string
          email?: string | null
          id?: string
          joined_at?: string | null
          member_code?: string | null
          name?: string
          note?: string | null
          team?: string | null
          role?: string
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          id: boolean
          require_login_from: string | null
          require_login_to_view: boolean
          updated_at: string
        }
        Insert: {
          id?: boolean
          require_login_from?: string | null
          require_login_to_view?: boolean
          updated_at?: string
        }
        Update: {
          id?: boolean
          require_login_from?: string | null
          require_login_to_view?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      nearby_parking: {
        Row: {
          checked_at: string
          created_at: string
          fee: string | null
          id: string
          lat: number | null
          lng: number | null
          memo: string | null
          name: string
          updated_at: string
          updated_by: string | null
          venue_id: string
          walk_minutes: number | null
        }
        Insert: {
          checked_at?: string
          created_at?: string
          fee?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          memo?: string | null
          name: string
          updated_at?: string
          updated_by?: string | null
          venue_id: string
          walk_minutes?: number | null
        }
        Update: {
          checked_at?: string
          created_at?: string
          fee?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          memo?: string | null
          name?: string
          updated_at?: string
          updated_by?: string | null
          venue_id?: string
          walk_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nearby_parking_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nearby_parking_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          nickname: string
        }
        Insert: {
          created_at?: string
          id: string
          nickname: string
        }
        Update: {
          created_at?: string
          id?: string
          nickname?: string
        }
        Relationships: []
      }
      venue_notes: {
        Row: {
          author_id: string | null
          body: string | null
          created_at: string
          id: string
          photo_paths: string[]
          section: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          id?: string
          venue_id: string
          section: string
          body?: string | null
          photo_paths?: string[]
        }
        Update: {
          body?: string | null
          photo_paths?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "venue_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_notes_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          body: string
          created_at: string
          handled_at: string | null
          id: string
          reply: string | null
          status: string
          user_id: string
        }
        Insert: {
          body: string
        }
        Update: {
          status?: string
          reply?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_user_profile_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_requests: {
        Row: {
          created_at: string
          handled_at: string | null
          id: string
          kind: string
          name: string
          reply: string | null
          requested_by: string | null
          status: string
          venue_id: string | null
        }
        Insert: {
          name: string
          kind?: string
          venue_id?: string | null
        }
        Update: {
          status?: string
          reply?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venue_requests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          branch_name: string | null
          building_name: string | null
          category: string
          created_at: string
          created_by: string | null
          floor: string | null
          former_names: string | null
          guest_free_minutes: number | null
          homepage: string | null
          id: string
          jibun_address: string | null
          lat: number
          lng: number
          name: string
          overtime_fee: number | null
          overtime_unit_minutes: number | null
          parking_checked_at: string | null
          parking_notes: string | null
          registered_industry: string | null
          road_address: string
          sido: string
          sigungu: string
          source: string
          source_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          branch_name?: string | null
          building_name?: string | null
          category: string
          created_at?: string
          created_by?: string | null
          floor?: string | null
          former_names?: string | null
          guest_free_minutes?: number | null
          homepage?: string | null
          id?: string
          jibun_address?: string | null
          lat: number
          lng: number
          name: string
          overtime_fee?: number | null
          overtime_unit_minutes?: number | null
          parking_checked_at?: string | null
          parking_notes?: string | null
          registered_industry?: string | null
          road_address: string
          sido: string
          sigungu: string
          source?: string
          source_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          branch_name?: string | null
          building_name?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          floor?: string | null
          former_names?: string | null
          guest_free_minutes?: number | null
          homepage?: string | null
          id?: string
          jibun_address?: string | null
          lat?: number
          lng?: number
          name?: string
          overtime_fee?: number | null
          overtime_unit_minutes?: number | null
          parking_checked_at?: string | null
          parking_notes?: string | null
          registered_industry?: string | null
          road_address?: string
          sido?: string
          sigungu?: string
          source?: string
          source_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venues_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venues_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      edits_with_user: {
        Row: {
          action: string | null
          created_at: string | null
          field: string | null
          id: number | null
          new_value: Json | null
          old_value: Json | null
          record_id: string | null
          table_name: string | null
          user_id: string | null
          user_nickname: string | null
          venue_id: string | null
        }
        Relationships: []
      }
      hall_schedules_computed: {
        Row: {
          day_type: string | null
          hall_id: string | null
          hall_name: string | null
          id: string | null
          interval_minutes: number | null
          is_simultaneous: boolean | null
          start_time: string | null
          venue_id: string | null
        }
        Relationships: []
      }
      member_login_stats: {
        Row: {
          devices_7d: number | null
          last_login_at: string | null
          logins_7d: number | null
          switches_24h: number | null
          switches_7d: number | null
          user_id: string | null
        }
        Relationships: []
      }
      venue_map: {
        Row: {
          branch_name: string | null
          category: string | null
          free_parking_2h: boolean | null
          has_simultaneous: boolean | null
          id: string | null
          last_checked_at: string | null
          lat: number | null
          lng: number | null
          name: string | null
          road_address: string | null
          same_address_count: number | null
          sido: string | null
          sigungu: string | null
          source: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _edit_ignored_columns: { Args: never; Returns: string[] }
      admin_delete_venue: { Args: { p_request_id: string }; Returns: string }
      admin_remove_venue: { Args: { p_venue_id: string }; Returns: string }
      admin_stats: { Args: never; Returns: Json }
      can_view: { Args: never; Returns: boolean }
      record_visit: { Args: { p_visitor: string }; Returns: undefined }
      email_login_status: { Args: { p_email: string }; Returns: string }
      request_access: { Args: { p_name: string; p_email: string; p_team: string }; Returns: string }
      claim_session: { Args: { p_device?: string; p_user_agent?: string }; Returns: string }
      is_active_member: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      normalize_phone: { Args: { p: string }; Returns: string }
      session_status: { Args: never; Returns: Json }
      day_types_overlap: { Args: { a: string; b: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]
export type Views<T extends keyof PublicSchema["Views"]> = PublicSchema["Views"][T]["Row"]
