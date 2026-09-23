# Financial Data Reconciliation and Reporting – End-to-End Process

The second part of the solution focuses on the **technical financial reporting process**.

Currently, the financial team does not receive all the required information from a single source. Instead, they have to collect and reconcile data from **three different sources**:

1. **ERP**
2. **Tally / Tally Prime**
3. **Email-based adjustments and supporting documents**

The purpose of the solution is to bring all three sources together, compare the data, identify mismatches or missing information, allow the auditor to validate the correct values, and finally generate the monthly financial report.

## 1. Current Financial Reporting Process

The financial department prepares a **monthly project-wise report**.

For every project, they need to understand:

- How much was spent during the month
- What the expenditure was related to
- What revenue was generated
- What the overall financial outcome was
- Whether the actual expenditure matches the information available in the different systems

The team currently collects this information manually from different sources and consolidates it, primarily using Excel.

There are also project-specific email addresses or domains. For example, if a particular email/domain is mapped to **Project 1**, the reports and supporting documents received through that email can be associated with Project 1. Similarly, another email/domain can be mapped to Project 2.

This project-to-email/domain mapping allows the application to identify which project a particular email or attachment belongs to.

## 2. Current Pain Point

The biggest challenge is that the financial team has to wait for information from multiple sources.

Some information is already available in the ERP and Tally, while certain additional expenses or last-minute adjustments may be communicated through email.

For example, vendors, subcontractors, suppliers, or project teams may send supporting information through email. If they are delayed in sending the required documents, the financial team cannot complete the monthly report on time.

The team has a fixed monthly closing date, around the **24th/25th**, by which the report needs to be completed.

If any source data is delayed, the financial team has to spend additional time manually following up, collecting documents, consolidating Excel files, and reconciling the information.

**This is the primary pain point that the proposed solution addresses.**

---

# 3. Proposed Dashboard

The application provides a centralized financial dashboard.

The homepage can display key financial information such as:

- Total number of projects being handled
- Total contract value
- Revenue
- Monthly revenue
- Monthly cost
- Profit margin
- Relevant office/project filters

The dashboard also provides graphical representations of the same KPIs.

For each project, the user can view:

- Revenue
- Cost
- Profit
- Other relevant financial indicators

This allows auditors and financial users to quickly identify which projects require attention.

---

# 4. Report Status and Delayed Data

The dashboard also helps identify the status of incoming reports.

For example, users can see:

- Which reports were received late
- Which reports are still pending
- Which sites have not submitted their reports
- Which data sources are incomplete

If a report is not received, it can appear under a **“Not Received”** status.

Once the site engineer or responsible project/platform team sends the report through email, the application can identify the email based on the configured project/domain mapping and extract the required Excel attachment.

This reduces the need for the finance team to manually search through emails.

---

# 5. Drill-Down to Project-Level Financial Data

From the dashboard, the auditor can drill down into a specific project.

At the project level, the system can display detailed financial line items such as:

- Opening balance/stock
- Closing balance/stock
- Revenue
- Expenditure
- Other project-specific financial information

The objective is to provide enough detail for the auditor to understand where each financial value originated.

---

# 6. Three Data Sources

The proposed solution integrates three primary sources.

### Source 1 – ERP

The ERP contains the core project and financial information.

For each project, the ERP can contain information such as:

- Purchase orders
- Purchase order values
- Invoices
- Bills
- Project expenditure
- Other project-related transactions

The exact ERP integration mechanism still needs to be confirmed because the ERP system/API details are not yet finalized.

### Source 2 – Tally / Tally Prime

Tally is a legacy financial/accounting application used for billing and related financial activities.

Currently, users may export data from Tally into Excel.

Instead of relying on manual Excel exports, the proposed approach is to retrieve the information through the **Tally Prime API**, subject to confirmation of the exact Tally version/environment being used.

For the demo, Tally Prime is being configured and the data is being extracted through the API.

### Source 3 – Email

Some information is not available in ERP or Tally because certain processes are not consistently followed in those systems.

These items may be communicated through email.

Examples include:

- Last-minute adjustments
- Additional expenses
- Daily expenses
- Supporting invoices
- Running account bills
- Weekly expenditure information
- Subcontractor/labour-related information

The application can monitor the configured project-specific email/domain and extract the relevant information and attachments.

---

# 7. Why Email Data Is Required

Ideally, all financial transactions should be recorded in the ERP.

However, in the current process, some project teams do not consistently enter every transaction into the ERP.

For example, there may be a small or last-minute expense that is not entered into the ERP or Tally but is communicated to the finance team through email.

Therefore, the email source acts as an additional source for capturing these adjustments.

The objective is not to replace ERP or Tally, but to capture the information that is missing from those systems and bring everything together for reconciliation.

---

# 8. Data Reconciliation

The core functionality of the solution is **reconciliation between the different sources**.

For example, suppose a particular subcontractor or labour expense is recorded as:

- ERP: ₹10,000
- Tally: ₹10,000
- Email adjustment: ₹2,000

The application should identify the differences between the available sources.

Where ERP and Tally contain different values, the auditor should be able to compare them.

For example:

**ERP → ₹26,000**  
**Tally → ₹66,000**

The auditor can review the difference and decide which value should be considered for the final report.

---

# 9. Auditor Validation

The application should not automatically assume that one source is always correct.

Instead, it should provide the auditor with the ability to select the appropriate value.

For example:

**ERP Value | Tally Value | Selected Value | Status**

If the auditor selects the ERP value, that value becomes the approved value for that particular line item.

If the auditor selects the Tally value, the Tally value becomes the approved value.

The selected value will then be used when generating the final Excel report.

This provides transparency and gives the auditor control over the reconciliation process.

---

# 10. Comparison View

The comparison screen should clearly show the values available from the relevant sources.

For example:

| Line Item | ERP | Tally | Email/Adjustment | Final Selected Value |
|---|---:|---:|---:|---:|
| Subcontractor | ₹10,000 | ₹10,500 | — | ₹10,500 |
| Labour | ₹26,000 | ₹66,000 | — | Auditor Selection |
| Additional Expense | — | — | ₹2,000 | ₹2,000 |

The exact fields and matching rules for email data still need to be finalized.

In particular, the team needs to confirm whether email information should be matched directly against the same financial line items available in ERP and Tally or treated as a separate adjustment category.

---

# 11. Email Synchronization

Email integration is an important part of the solution.

The system needs to know whether the required project email accounts are connected and synchronized.

The expected process is:

**Project → Project Email/Domain → Incoming Email → Attachment → Data Extraction → Project Mapping → Reconciliation**

For example, if there are 70–80 projects, manually requesting reports from every project team can become time-consuming.

Instead, each project can have a dedicated email/domain mapping.

The application can then monitor the relevant mailbox and automatically identify incoming reports.

---

# 12. Automated Notifications and Follow-Up

The system can also help prevent delayed submissions.

For example, if the monthly closing date is the 25th, the application can maintain a buffer period of approximately 3–7 days.

Before the deadline, the system can send notifications to the relevant project/team members:

**“Please submit your monthly report.”**

If the report is not received within the expected period, the status can automatically move to:

**Pending → Overdue**

This gives the finance team visibility into which projects have not submitted their information.

The exact buffer period and notification schedule need to be confirmed with the business team.

---

# 13. Data Synchronization / Refresh

The current proposed approach is to provide a **Refresh/Sync** action.

When the user initiates the refresh:

1. The application connects to the configured data sources.
2. ERP data is retrieved.
3. Tally data is retrieved.
4. Email data is synchronized.
5. Relevant attachments are extracted.
6. Data is mapped to the appropriate project.
7. The system compares the available information.
8. Mismatches are identified.
9. The latest reconciliation status is displayed.

The application should also show the user when the synchronization or report generation was completed.

For example:

**“Last synchronized: 1 minute ago.”**

The final decision on whether synchronization will be fully automatic, scheduled, or manually triggered still needs to be confirmed.

---

# 14. Project and Client Data

There can also be scenarios where project-related information is received from an external client or organization.

For example, if the project involves a client such as VIT, the team needs to confirm how the email/domain relationship will work.

The key requirement is that the system should ultimately be able to determine:

**Which project does this information belong to?**

Therefore, the project/domain mapping needs to be clearly defined.

The exact external-domain scenario and ownership of the email accounts still need to be confirmed.

---

# 15. End-to-End Financial Flow

The complete proposed process can therefore be represented as:

**ERP + Tally + Email**

↓

**Data Collection**

↓

**Project / Domain Mapping**

↓

**Data Extraction**

↓

**Data Standardization**

↓

**Project-wise Matching**

↓

**Source Comparison**

↓

**Mismatch Identification**

↓

**Auditor Review**

↓

**Auditor Selection / Adjustment**

↓

**Final Approved Financial Data**

↓

**Excel Report Generation**

↓

**Monthly Financial Submission**

This provides a single workflow instead of requiring the finance team to manually collect and reconcile information from multiple sources.

---

# 16. Final Excel Report

Once reconciliation is completed, the auditor can make any required adjustments.

The system then generates the final Excel report according to the required business template.

The values selected by the auditor during reconciliation will be reflected in the generated Excel sheet.

For example, if the auditor selects the Tally value for a particular line item, the Tally value will appear in the final report.

Similarly, if the auditor selects the ERP value, the ERP value will be reflected.

The final report therefore becomes the **approved output of the reconciliation process**.

---

# 17. Proposed Demo Approach

For the demo, actual production data may not be available.

If the business team provides a mock database or sample data, the same process can be replicated using representative project data.

Since projects may have a duration of approximately 2–3 years, sufficient historical/sample data can be generated to demonstrate:

- Multiple projects
- Monthly transactions
- Revenue
- Costs
- Profit margins
- ERP data
- Tally data
- Email adjustments
- Missing reports
- Delayed reports
- Source mismatches
- Auditor selections
- Final reconciliation
- Excel report generation

This will allow the team to demonstrate the complete solution to a real audience without requiring direct access to production systems.

---

# 18. Overall Objective

The overall objective of the solution is to **reduce manual financial reconciliation and improve the timeliness and accuracy of monthly project reporting**.

Instead of the finance team manually collecting information from ERP, Tally, emails, and Excel files, the application brings these sources together into one workflow.

The system provides visibility from:

**Data Collection → Reconciliation → Auditor Validation → Final Report**

This directly addresses the current pain point of delayed data, manual follow-ups, Excel-based consolidation, and time-consuming monthly reporting.