
export interface CategoryScore {
  score: number | null; // Null means "Not Applicable" / "Not Present"
  observation: string;
}

export interface Scorecard {
  doors: CategoryScore;
  house_number: CategoryScore;
  windows: CategoryScore;
  landscaping: CategoryScore;
  vegetation: CategoryScore;
  roof: CategoryScore;
  fascia: CategoryScore;
  paint: CategoryScore;
  driveway: CategoryScore;
  fence: CategoryScore;
  debris: CategoryScore;
  pool: CategoryScore;
  facade_condition: CategoryScore; // New Category
}

export interface VisibilityAssessment {
  overall_score: number;
  capture_date: string;
  setback_distance: "Curbside" | "Medium Setback" | "Deep Setback / Hidden";
  is_blurred: boolean;
  obstructions: string[];
  hallucination_warning: boolean;
}

export interface DistressAnalysis {
  distress_score: number;
  tier_label: string;
  investor_action: string;
  primary_red_flags: string[];
  structural_observations: string;
  mechanical_status: string;
  investment_summary: string;
  scorecard: Scorecard;
  visibility: VisibilityAssessment;
}

export interface PropertyImage {
  data: string;
  label: string;
}

export interface PropertyMetadata {
  streetview_available: boolean;
  streetview_date: string | null;
  streetview_year: number | null;
  aerial_available: boolean;
  aerial_date: string | null;
}

export interface PropertyRecord {
  id: string;
  address: string;
  timestamp: number;
  images: PropertyImage[]; 
  analysis: DistressAnalysis;
  metadata: PropertyMetadata;
}

export interface TrainingExample {
  id: string;
  category: keyof Scorecard;
  observation_text: string;
  corrected_score: number | null;
  timestamp: number;
}

export enum ViewState {
  DASHBOARD = 'DASHBOARD',
  ANALYZE = 'ANALYZE',
}

export interface ViewQualityCheck {
  is_front_visible: boolean;
  view_type: "front_facade" | "side_view" | "back_view" | "driveway" | "obstructed" | "street_only" | "split_view";
  reason: string;
  suggested_action: "NONE" | "ROTATE_CW" | "ROTATE_CCW" | "MOVE_LEFT" | "MOVE_RIGHT";
  action_magnitude: number;
}

export interface SubjectMatchCheck {
  is_match: boolean;
  confidence: number;
  reason: string;
}

export interface SmartScoutTarget {
  sector: "roof_left" | "roof_center" | "roof_right" | "facade_left" | "facade_center" | "facade_right" | "ground_left" | "ground_center" | "ground_right";
  reason: string;
}
