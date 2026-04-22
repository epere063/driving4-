
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { DistressAnalysis, ViewQualityCheck, SubjectMatchCheck, SmartScoutTarget, VisibilityAssessment, Scorecard, TrainingExample } from '../types';
import { getTrainingExamples } from "./db";

// Updated System Prompt with Fluidity and NULL instructions
const SYSTEM_PROMPT = `
You are a Real Estate Investment Underwriter using a strict "Master Underwriting Scorecard".

*** COMPOSITE ANALYSIS INSTRUCTION ***
1. Treat images as a single dataset. A defect in a Zoom shot counts heavily.
2. If images contradict, TRUST THE ZOOM/DETAIL SHOT.

*** ANTI-HALLUCINATION ***
1. If 'Visibility Assessment' is LOW/BLURRED, do not invent features.
2. If a specific feature (e.g., Pool, Fence) is NOT PRESENT/NOT VISIBLE, you must return 'null' for the score. Do NOT return 0. 0 means "Pristine Condition", null means "Does not exist".

*** SCORING PHILOSOPHY: FLUIDITY ***
The Rubric below provides ANCHORS (Examples).
- Do not strictly limit yourself to these specific examples.
- USE INTERPOLATION. If a roof is worse than score 2 but better than score 5, score it a 3 or 4.
- Use your reasoning to determine severity relative to the anchors.

*** MASTER SCORING RUBRIC (0-10) ***
(Return 'null' if feature is missing)

1. Doors
0: Modern/New.
5: Fading, water stains.
10: Missing door, plywood.

2. House Number
0: Professional.
10: Spray-painted on wood.

3. Windows
0: Impact glass/New.
5: Jalousie/Old Frames.
8: Left open in heat.
10: Boarded (Plywood) / Red X.

4. Grass & Landscaping
0: Manicured.
5: Patchy/Thin.
7: Overgrown >6in.

5. Vegetation & Environmental
0: Professional.
6: Plants growing into house.
8: Trees touching roof.

6. Roof
0: New Metal/Tile.
5: Heavy Algae/Dark Streaks.
7: Brittle/Rot.
10: TARPS (Blue/Orange).

7. Fascia
0: Fresh.
8: Rotted/Exposed Rafters.

8. Paint
0: Fresh.
3: Chalky.
7: Peeling/Flaking.

9. Driveway
0: Perfect.
6: Dirt patches/Weeds in cracks.

10. Fence (Null if none)
0: Luxury/Sound.
6: Rusted.
10: Broken/Falling.

11. Debris (Null if clean)
0: Zero.
7: Scattered trash.
10: Hoarder junk/Abandoned cars.

12. Pool (Null if none)
0: Clean Blue.
10: Green/Black Swamp.

13. Facade Condition (Stucco/Brick/Siding)
0: Perfect, uniform texture.
3: Hairline cracks, minor weathering.
6: Visible patch repairs (mismatched stucco), chipping around windows/doors.
8: Deep settlement cracks (step-cracks), spalling, exposed block/lath.
10: Large sections missing, structural failure.
`;

const CATEGORY_SCORE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.NUMBER, description: "Score 0-10. Return null if feature is missing or not applicable.", nullable: true },
    observation: { type: Type.STRING, description: "Visual evidence." }
  },
  required: ["score", "observation"]
};

const VISIBILITY_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    overall_score: { type: Type.NUMBER, description: "0-10. 0=Blurred/Hidden, 10=Clear" },
    capture_date: { type: Type.STRING },
    setback_distance: { type: Type.STRING, enum: ["Curbside", "Medium Setback", "Deep Setback / Hidden"] },
    is_blurred: { type: Type.BOOLEAN, description: "Is the house blurred by Google privacy?" },
    obstructions: { type: Type.ARRAY, items: { type: Type.STRING } },
    hallucination_warning: { type: Type.BOOLEAN, description: "True if visibility is too low to score accurately." }
  },
  required: ["overall_score", "capture_date", "setback_distance", "is_blurred", "obstructions", "hallucination_warning"]
};

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    // Note: distress_score is calculated by the model, but we will overwrite it in JS to ensure N/A logic is perfect.
    distress_score: { type: Type.NUMBER },
    tier_label: { type: Type.STRING },
    investor_action: { type: Type.STRING },
    primary_red_flags: { type: Type.ARRAY, items: { type: Type.STRING } },
    structural_observations: { type: Type.STRING },
    mechanical_status: { type: Type.STRING },
    investment_summary: { type: Type.STRING },
    scorecard: {
      type: Type.OBJECT,
      properties: {
        doors: CATEGORY_SCORE_SCHEMA,
        house_number: CATEGORY_SCORE_SCHEMA,
        windows: CATEGORY_SCORE_SCHEMA,
        landscaping: CATEGORY_SCORE_SCHEMA,
        vegetation: CATEGORY_SCORE_SCHEMA,
        roof: CATEGORY_SCORE_SCHEMA,
        fascia: CATEGORY_SCORE_SCHEMA,
        paint: CATEGORY_SCORE_SCHEMA,
        driveway: CATEGORY_SCORE_SCHEMA,
        fence: CATEGORY_SCORE_SCHEMA,
        debris: CATEGORY_SCORE_SCHEMA,
        pool: CATEGORY_SCORE_SCHEMA,
        facade_condition: CATEGORY_SCORE_SCHEMA // Added to Schema
      },
      required: ["doors", "house_number", "windows", "landscaping", "vegetation", "roof", "fascia", "paint", "driveway", "fence", "debris", "pool", "facade_condition"]
    }
  },
  required: ["distress_score", "tier_label", "investor_action", "primary_red_flags", "structural_observations", "mechanical_status", "investment_summary", "scorecard"],
};

const VIEW_CHECK_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    is_front_visible: { type: Type.BOOLEAN },
    view_type: { 
      type: Type.STRING, 
      enum: ["front_facade", "side_view", "split_view", "back_view", "driveway", "obstructed", "street_only"] 
    },
    reason: { type: Type.STRING },
    suggested_action: { 
      type: Type.STRING, 
      enum: ["NONE", "ROTATE_CW", "ROTATE_CCW", "MOVE_LEFT", "MOVE_RIGHT"] 
    },
    action_magnitude: { type: Type.NUMBER, description: "Degrees for rotation (10-90) or Meters for move (10-30)" }
  },
  required: ["is_front_visible", "view_type", "reason", "suggested_action", "action_magnitude"]
};

const SUBJECT_MATCH_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    is_match: { type: Type.BOOLEAN, description: "True ONLY if Image 2 shows the SAME building (or a detail of it) as Image 1." },
    confidence: { type: Type.NUMBER, description: "0.0 to 1.0" },
    reason: { type: Type.STRING }
  },
  required: ["is_match", "confidence", "reason"]
};

const SMART_SCOUT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    targets: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sector: {
            type: Type.STRING,
            enum: ["roof_left", "roof_center", "roof_right", "facade_left", "facade_center", "facade_right", "ground_left", "ground_center", "ground_right"]
          },
          reason: { type: Type.STRING, description: "Why is this area interesting? e.g. 'Possible tarp', 'Boarded window'" }
        },
        required: ["sector", "reason"]
      }
    }
  },
  required: ["targets"]
};

function getApiKey(): string {
  let apiKey = process.env.API_KEY || "";
  apiKey = apiKey.trim().replace(/^['"]|['"]$/g, '');
  if (!apiKey) throw new Error("API Key not found.");
  return apiKey;
}

async function fileToGenerativePart(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      const base64Data = base64String.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// *** Training Data Injection ***
async function getTrainingContext(): Promise<string> {
    const examples = await getTrainingExamples();
    if (examples.length === 0) return "";

    // Take the 15 most recent examples to fit in context
    const recent = examples.sort((a,b) => b.timestamp - a.timestamp).slice(0, 15);
    
    let context = "\n*** USER-DEFINED TRAINING PRECEDENTS (Use these to calibrate your scoring) ***\n";
    recent.forEach(ex => {
        context += `- Condition: "${ex.observation_text}" for category '${ex.category}' was manually corrected to Score: ${ex.corrected_score}.\n`;
    });
    context += "*** End Precedents ***\n";
    return context;
}

// Helper to manually calculate score to strictly handle NULLs
// UPDATED LOGIC: Uses "Top 5 Worst" Average instead of total average.
function calculateWeightedDistress(scorecard: Scorecard): { score: number, tier: string } {
    const categories = Object.values(scorecard);
    
    // 1. Extract valid scores (exclude nulls)
    const validScores = categories
        .map(c => c.score)
        .filter(s => s !== null && s !== undefined && s >= 0) as number[];

    if (validScores.length === 0) return { score: 0, tier: "Tier 1: No Data" };

    // 2. Sort DESCENDING to find the worst issues (Highest numbers)
    // e.g. [10, 10, 8, 5, 2, 0, 0...]
    validScores.sort((a, b) => b - a);

    // 3. Take the Top 5 Worst Scores (or fewer if we don't have 5)
    // This prevents a clean driveway (0) from diluting a collapsed roof (10).
    const topBadScores = validScores.slice(0, 5);
    
    const sum = topBadScores.reduce((a, b) => a + b, 0);
    // Average only the top contributors
    const avg = parseFloat((sum / topBadScores.length).toFixed(1));

    let tier = "Tier 1: Institutional/Pristine";
    if (avg > 9.0) tier = "Tier 5: Dilapidated / Land Value";
    else if (avg > 7.5) tier = "Tier 4: High Distress / Immediate Action";
    else if (avg > 5.5) tier = "Tier 3: Active Investment Opportunity";
    else if (avg > 2.5) tier = "Tier 2: Aged Retail";

    return { score: avg, tier };
}

export const assessVisibility = async (streetFile: File, aerialFile: File, metaDate: string): Promise<VisibilityAssessment> => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });
  
  // Check if streetFile is actually an aerial (fallback logic if no street view)
  const isStreetActuallyAerial = streetFile.name.toLowerCase().includes('aerial');
  
  if (isStreetActuallyAerial) {
      return {
          overall_score: 0,
          capture_date: metaDate,
          setback_distance: "Deep Setback / Hidden",
          is_blurred: false,
          obstructions: ["Street View Unavailable - Aerial Only"],
          hallucination_warning: true
      };
  }

  const streetBase64 = await fileToGenerativePart(streetFile);
  const aerialBase64 = await fileToGenerativePart(aerialFile);

  try {
      const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: {
              parts: [
                  { inlineData: { data: streetBase64, mimeType: streetFile.type } },
                  { inlineData: { data: aerialBase64, mimeType: aerialFile.type } },
                  { text: `Analyze the visibility of the subject property.
                  
                  Image 1: Street View.
                  Image 2: Aerial View.
                  Metadata Date: ${metaDate}

                  Check for:
                  1. Privacy Blur: Is the house blurred out by Google? (Automatic disqualification).
                  2. Setback: Use Aerial to judge if house is close to road or hidden deep on lot.
                  3. Obstructions: Tall hedges, fences, trucks blocking view.
                  
                  Score from 0 (Invisible) to 10 (Clear).
                  If Blurred, Setback is "Deep/Hidden", or blocked by Hedge, set hallucination_warning = TRUE.
                  `}
              ]
          },
          config: {
              responseMimeType: "application/json",
              responseSchema: VISIBILITY_SCHEMA,
              temperature: 0.1
          }
      });
      const text = response.text;
      if (!text) throw new Error("No visibility response");
      return JSON.parse(text) as VisibilityAssessment;
  } catch (e) {
      console.warn("Visibility check failed", e);
      return {
          overall_score: 5,
          capture_date: metaDate,
          setback_distance: "Medium Setback",
          is_blurred: false,
          obstructions: ["Analysis Failed"],
          hallucination_warning: true
      };
  }
};

export const analyzePropertyImages = async (
  imageFiles: File[],
  visibilityAnalysis: VisibilityAssessment
): Promise<DistressAnalysis> => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const imageParts = await Promise.all(
    imageFiles.map(async (file) => {
      const base64Data = await fileToGenerativePart(file);
      return {
        inlineData: {
          data: base64Data,
          mimeType: file.type,
        },
      };
    })
  );

  // FETCH TRAINING DATA
  const trainingContext = await getTrainingContext();

  // Handle Missing Street View
  const hasStreetView = imageFiles.some(f => !f.name.toLowerCase().includes('aerial'));
  let additionalContext = "";
  
  if (!hasStreetView) {
      additionalContext = `
      *** NO STREET VIEW AVAILABLE ***
      Only Aerial views are provided.
      1. IGNORE categories: Doors, House Number, Windows, Fascia, Paint, Facade Condition. Score them as 'null' (Do not hallucinate).
      2. ONLY analyze: Roof, Landscaping, Driveway, Pool, Debris, Fence.
      3. Set 'structural_observations' to "Limited to aerial inspection. Street view unavailable."
      4. Override Visibility Score to 0 internally.
      `;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview', 
      contents: {
        parts: [
          ...imageParts,
          { text: `Analyze these property images using the Master Underwriting Scorecard.
          
          CONTEXT:
          Visibility Score: ${visibilityAnalysis.overall_score}/10
          Setback: ${visibilityAnalysis.setback_distance}
          Is Blurred: ${visibilityAnalysis.is_blurred}
          Obstructions: ${visibilityAnalysis.obstructions.join(", ")}
          
          ${trainingContext}
          ${additionalContext}

          If visibility is LOW (<4) or Blurred, DO NOT HALLUCINATE FEATURES. Mark them as observed="Not Visible due to obstruction/blur" and score neutral (0) or null.
          ` }
        ]
      },
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.1, 
      },
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");

    const result = JSON.parse(text) as DistressAnalysis;
    result.visibility = visibilityAnalysis;

    // *** OVERRIDE GEMINI MATH ***
    // We calculate the final score locally using "Worst 5" methodology.
    const calculated = calculateWeightedDistress(result.scorecard);
    result.distress_score = calculated.score;
    result.tier_label = calculated.tier;

    return result;
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw error;
  }
};

export const checkViewQuality = async (file: File): Promise<ViewQualityCheck> => {
    const apiKey = getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    const base64Data = await fileToGenerativePart(file);
    
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: {
                parts: [
                    { inlineData: { data: base64Data, mimeType: file.type } },
                    { text: `Analyze this Street View image for property assessment suitability.
                    
                    Primary Question: Is the FRONT FACADE of a single residential house clearly visible and reasonably centered?
                    
                    Return 'is_front_visible': FALSE if:
                    1. The view is OBSTRUCTED by large trees, bushes, or vehicles blocking >50% of the house.
                    2. The view is SPLIT (camera pointing between two houses).
                    3. The view is looking down the STREET (road perspective).
                    4. It appears to be a NEIGHBOR'S house.

                    If FALSE, provide a 'suggested_action':
                    - ROTATE_CW: If the house is visible on the RIGHT edge.
                    - ROTATE_CCW: If the house is visible on the LEFT edge.
                    - MOVE_LEFT: If obstructing object (tree/truck) is in center, move camera LEFT along street.
                    - MOVE_RIGHT: If obstructing object is in center, move camera RIGHT along street.
                    
                    Magnitude: 
                    - Rotation: 20-45 degrees.
                    - Move: 10-20 meters.
                    ` }
                ]
            },
            config: {
                responseMimeType: "application/json",
                responseSchema: VIEW_CHECK_SCHEMA,
                temperature: 0.1
            }
        });
        const text = response.text;
        if (!text) return { is_front_visible: true, view_type: "front_facade", reason: "Defaulting", suggested_action: "NONE", action_magnitude: 0 };
        return JSON.parse(text) as ViewQualityCheck;
    } catch (e) {
        return { is_front_visible: true, view_type: "front_facade", reason: "Error", suggested_action: "NONE", action_magnitude: 0 };
    }
};

export const verifySubjectMatch = async (referenceFile: File, candidateFile: File): Promise<SubjectMatchCheck> => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });
  const refBase64 = await fileToGenerativePart(referenceFile);
  const candBase64 = await fileToGenerativePart(candidateFile);

  try {
      const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: {
              parts: [
                  { inlineData: { data: refBase64, mimeType: referenceFile.type } },
                  { inlineData: { data: candBase64, mimeType: candidateFile.type } },
                  { text: `Compare Image 2 (Candidate) with Image 1 (Master Reference).
                  
                  Question: Is Image 2 a ZOOMED IN DETAIL, OBLIQUE ANGLE, or DRIVE-BY VIEW of the SAME HOUSE shown in Image 1?
                  
                  - If Image 2 shows a neighbor's house, return is_match: FALSE.
                  - If Image 2 is just sky or trees with no building parts, return is_match: FALSE.
                  - If Image 2 is a close-up of a window/roof/door from Image 1, return is_match: TRUE.
                  - If Image 2 is an OBLIQUE VIEW (corner shot) showing the same facade from the side, return is_match: TRUE.
                  `}
              ]
          },
          config: {
              responseMimeType: "application/json",
              responseSchema: SUBJECT_MATCH_SCHEMA,
              temperature: 0.0
          }
      });
      const text = response.text;
      if (!text) return { is_match: false, confidence: 0, reason: "No response" };
      return JSON.parse(text) as SubjectMatchCheck;
  } catch (e) {
      return { is_match: false, confidence: 0, reason: "Error" };
  }
};

export const performSmartScout = async (scoutImage: File): Promise<SmartScoutTarget[]> => {
    const apiKey = getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    const base64Data = await fileToGenerativePart(scoutImage);

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: {
                parts: [
                    { inlineData: { data: base64Data, mimeType: scoutImage.type } },
                    { text: `You are a Survey Drone. Scan this property for "Areas of Interest" that require a HIGH-RESOLUTION ZOOM INSPECTION.
                    
                    Look for subtle or obvious signs of:
                    1. ROOF: Discoloration, tarps, patches, missing shingles. (Sectors: roof_left, roof_center, roof_right)
                    2. FACADE/WINDOWS: Boarded windows, broken glass, open windows, AC units, missing doors. (Sectors: facade_left, facade_center, facade_right)
                    3. GROUND/YARD: Debris piles, overgrown jungle, oil stains, broken fences. (Sectors: ground_left, ground_center, ground_right)

                    Instructions:
                    - If you see ANY potential defect, flag that sector.
                    - Be aggressive. If the roof looks even slightly old, request a zoom.
                    - Return a list of sectors to target.` }
                ]
            },
            config: {
                responseMimeType: "application/json",
                responseSchema: SMART_SCOUT_SCHEMA,
                temperature: 0.2
            }
        });
        
        const text = response.text;
        if (!text) return [];
        const result = JSON.parse(text) as { targets: SmartScoutTarget[] };
        return result.targets || [];
    } catch (e) {
        console.warn("Smart Scout failed", e);
        return [];
    }
};
