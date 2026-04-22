
import { PropertyRecord, TrainingExample } from "../types";

const DB_NAME = "DistressScoutDB";
const STORE_NAME = "properties";
const TRAINING_STORE = "training_data";
const DB_VERSION = 2; // Incrementing version to add new store

export const initDB = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error("DB Error", event);
      reject("Failed to open DB");
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(TRAINING_STORE)) {
        db.createObjectStore(TRAINING_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => {
      resolve();
    };
  });
};

export const saveRecord = (record: PropertyRecord): Promise<void> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const req = store.put(record);

      req.onsuccess = () => resolve();
      req.onerror = () => reject("Failed to save record");
    };
    request.onerror = () => reject("Failed to open DB for saving");
  });
};

export const getAllRecords = (): Promise<PropertyRecord[]> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const records = (req.result as PropertyRecord[]).sort((a, b) => b.timestamp - a.timestamp);
        resolve(records);
      };
      req.onerror = () => reject("Failed to fetch records");
    };
    request.onerror = () => reject("Failed to open DB for fetching");
  });
};

export const saveTrainingExample = (example: TrainingExample): Promise<void> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction([TRAINING_STORE], "readwrite");
        const store = transaction.objectStore(TRAINING_STORE);
        const req = store.put(example);
  
        req.onsuccess = () => resolve();
        req.onerror = () => reject("Failed to save training data");
      };
    });
};

export const getTrainingExamples = (): Promise<TrainingExample[]> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const transaction = db.transaction([TRAINING_STORE], "readonly");
          const store = transaction.objectStore(TRAINING_STORE);
          const req = store.getAll();
    
          req.onsuccess = () => {
            resolve(req.result as TrainingExample[]);
          };
        };
    });
};
