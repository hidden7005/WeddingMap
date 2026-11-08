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
          name: string
          photo_notes: string | null
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
          name: string
          photo_notes?: string | null
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
          name?: string
          photo_notes?: string | null
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
      venues: {
        Row: {
          biz_no: string | null
          branch_name: string | null
          bridal_room_info: string | null
          building_name: string | null
          category: string
          created_at: string
          created_by: string | null
          equipment_route: string | null
          external_snap_policy: string | null
          external_vendor_fee: number | null
          flash_policy: string | null
          floor: string | null
          former_names: string | null
          guest_free_methods: string[] | null
          guest_free_minutes: number | null
          homepage: string | null
          hotel_grade: string | null
          id: string
          jibun_address: string | null
          lat: number
          lng: number
          name: string
          official_photo_timing: string | null
          official_vendor_designated: boolean | null
          official_vendor_name: string | null
          overtime_fee: number | null
          overtime_unit_minutes: number | null
          parking_capacity: string | null
          parking_checked_at: string | null
          parking_notes: string | null
          pass_required: boolean | null
          phone: string | null
          photo_checked_at: string | null
          photo_notes: string | null
          registered_industry: string | null
          road_address: string
          room_count: number | null
          sido: string
          sigungu: string
          source: string
          source_key: string
          updated_at: string
          updated_by: string | null
          wedding_confirm: string | null
        }
        Insert: {
          biz_no?: string | null
          branch_name?: string | null
          bridal_room_info?: string | null
          building_name?: string | null
          category: string
          created_at?: string
          created_by?: string | null
          equipment_route?: string | null
          external_snap_policy?: string | null
          external_vendor_fee?: number | null
          flash_policy?: string | null
          floor?: string | null
          former_names?: string | null
          guest_free_methods?: string[] | null
          guest_free_minutes?: number | null
          homepage?: string | null
          hotel_grade?: string | null
          id?: string
          jibun_address?: string | null
          lat: number
          lng: number
          name: string
          official_photo_timing?: string | null
          official_vendor_designated?: boolean | null
          official_vendor_name?: string | null
          overtime_fee?: number | null
          overtime_unit_minutes?: number | null
          parking_capacity?: string | null
          parking_checked_at?: string | null
          parking_notes?: string | null
          pass_required?: boolean | null
          phone?: string | null
          photo_checked_at?: string | null
          photo_notes?: string | null
          registered_industry?: string | null
          road_address: string
          room_count?: number | null
          sido: string
          sigungu: string
          source?: string
          source_key: string
          updated_at?: string
          updated_by?: string | null
          wedding_confirm?: string | null
        }
        Update: {
          biz_no?: string | null
          branch_name?: string | null
          bridal_room_info?: string | null
          building_name?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          equipment_route?: string | null
          external_snap_policy?: string | null
          external_vendor_fee?: number | null
          flash_policy?: string | null
          floor?: string | null
          former_names?: string | null
          guest_free_methods?: string[] | null
          guest_free_minutes?: number | null
          homepage?: string | null
          hotel_grade?: string | null
          id?: string
          jibun_address?: string | null
          lat?: number
          lng?: number
          name?: string
          official_photo_timing?: string | null
          official_vendor_designated?: boolean | null
          official_vendor_name?: string | null
          overtime_fee?: number | null
          overtime_unit_minutes?: number | null
          parking_capacity?: string | null
          parking_checked_at?: string | null
          parking_notes?: string | null
          pass_required?: boolean | null
          phone?: string | null
          photo_checked_at?: string | null
          photo_notes?: string | null
          registered_industry?: string | null
          road_address?: string
          room_count?: number | null
          sido?: string
          sigungu?: string
          source?: string
          source_key?: string
          updated_at?: string
          updated_by?: string | null
          wedding_confirm?: string | null
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
          official_vendor_designated: boolean | null
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
