export const sampleUg = {
  processes: {
    onboarding: {
      id: "process_onboarding",
      name: "Employee Onboarding",
      tasks: {
        task_request: {
          id: "task_request",
          name: "Submit onboarding request",
          detail: "Manager submits onboarding request for a new hire.",
          tags: ["request", "manager"],
          edges: ["task_collect"],
          checklist: [
            { text: "Confirm approved headcount" },
            { text: "Fill out request form" }
          ]
        },
        task_collect: {
          id: "task_collect",
          name: "Collect candidate info",
          detail: "HR collects personal details and required documents.",
          tags: ["hr"],
          roles: { R: ["HR"], A: ["HR Lead"], C: ["Manager"], I: ["IT"] },
          edges: ["task_provision"],
          acceptance: ["All required documents received"],
          evidence: { storage: "Drive", path: "/onboarding/docs" }
        },
        task_provision: {
          id: "task_provision",
          name: "Provision accounts",
          detail: "IT provisions required accounts and equipment.",
          tags: ["it", "accounts"],
          edges: ["task_orientation"],
          sla: { duration: "3d" },
          controls: { id: "CTRL-42", name: "Access provisioning" }
        },
        task_orientation: {
          id: "task_orientation",
          name: "Run orientation",
          detail: "Orientation session for the new employee.",
          tags: ["orientation"],
          edges: []
        }
      },
      gateways: {
        gw_docs: {
          id: "gw_docs",
          name: "Documents complete?",
          edges: [
            { id: "gw_docs_yes", from_id: "gw_docs", to_id: "task_provision", condition: { expression: "yes" } },
            { id: "gw_docs_no", from_id: "gw_docs", to_id: "task_collect", condition: { expression: "no" } }
          ]
        }
      },
      edges: [
        { id: "req_to_gw", from_id: "task_request", to_id: "gw_docs" },
        { id: "orientation_end", from_id: "task_orientation", to_id: "event_finish" }
      ],
      events: {
        event_start: {
          id: "event_start",
          name: "Start",
          edges: ["task_request"]
        },
        event_finish: {
          id: "event_finish",
          name: "Finish"
        }
      }
    }
  }
};
