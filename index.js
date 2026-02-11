import express from "express";
import { KubeConfig, CoreV1Api } from "@kubernetes/client-node";
import { v4 as uuidv4 } from "uuid";
import { exec } from "child_process";

const app = express();
app.use(express.json());

/* =================================
   Kubernetes Setup
================================= */
const kc = new KubeConfig();
kc.loadFromDefault();
const coreApi = kc.makeApiClient(CoreV1Api);

/* =================================
   CONFIG
================================= */
const CHART_PATH =
  "C:/Users/harsh/OneDrive/Desktop/external/charts/store";

/* =================================
   In-Memory Store Registry
================================= */
const storeRegistry = {};

/* =================================
   CREATE STORE
================================= */
app.post("/stores", async (req, res) => {
  const storeId = "store-" + uuidv4().slice(0, 6);

  if (storeRegistry[storeId]) {
    return res.status(400).json({ error: "Store already exists" });
  }

  storeRegistry[storeId] = {
    id: storeId,
    status: "Provisioning",
    url: `http://${storeId}.localtest.me`,
    createdAt: new Date(),
  };

  try {
    // 1️⃣ Create Namespace
    await coreApi.createNamespace({
      body: {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name: storeId },
      },
    });

    // 2️⃣ Install Helm Chart
    exec(
      `helm install ${storeId} "${CHART_PATH}" -n ${storeId}`,
      (error) => {
        if (error) {
          console.error("Helm Install Error:", error);
          storeRegistry[storeId].status = "Failed";
        }
      }
    );

    res.json(storeRegistry[storeId]);
  } catch (err) {
    console.error("Create Error:", err);
    storeRegistry[storeId].status = "Failed";
    res.status(500).json({ error: "Failed to create store" });
  }
});

/* =================================
   LIST STORES
================================= */
app.get("/stores", (req, res) => {
  res.json(Object.values(storeRegistry));
});

/* =================================
   DELETE STORE
================================= */
app.delete("/stores/:id", async (req, res) => {
  const storeId = req.params.id;

  if (!storeRegistry[storeId]) {
    return res.status(404).json({ error: "Store not found" });
  }

  try {
    await new Promise((resolve) =>
      exec(`helm uninstall ${storeId} -n ${storeId}`, resolve)
    );

    await coreApi.deleteNamespace({ name: storeId });

    delete storeRegistry[storeId];

    res.json({ message: "Store deleted successfully" });
  } catch (err) {
    console.error("Delete Error:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

/* =================================
   STATUS POLLING (Provisioning → Ready)
================================= */
setInterval(async () => {
  for (const storeId in storeRegistry) {
    if (storeRegistry[storeId].status !== "Provisioning") continue;

    try {
      const response = await coreApi.listNamespacedPod({
        namespace: storeId,
      });

      const pods = response.body?.items || [];

      if (pods.length === 0) continue;

      const allReady = pods.every((pod) => {
        const statuses = pod.status?.containerStatuses || [];
        return statuses.length > 0 && statuses.every((c) => c.ready === true);
      });

      if (allReady) {
        console.log(`✅ Store ${storeId} is now Ready`);
        storeRegistry[storeId].status = "Ready";
      }
    } catch (err) {
      console.log("Polling error:", err.message);
    }
  }
}, 5000);

/* =================================
   HEALTH CHECK
================================= */
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* =================================
   START SERVER
================================= */
app.listen(3001, "0.0.0.0", () => {
  console.log("Backend running on http://localhost:3001");
});