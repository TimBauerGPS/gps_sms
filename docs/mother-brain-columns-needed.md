# Mother Brain Columns Needed

App name: Guardian SMS (gps_sms_generators)
Purpose: Imports Allied's jobs for scheduled customer SMS, the send queue, pulse checks, inbox job matching, and template placeholders.

The import asks for every column the API key allows. The required columns must be on the key or the import stops. The template columns are optional: each one the key allows can be used as a `{{placeholder}}`.

## Columns For The API Key

Copy this list into the Mother Brain API key generator:

```text
Name, Customer, Customer Phone Number, Status, Link to Project, Created At, Inspection Date, Estimated Work Start Date, File Closed, Estimate sent, Contract Signed, COC/COS Signed, Invoiced, Work Start, Paid, Estimated Completion Date, Project Manager, Estimator, Sales Person, Dispatch/Coordinator, Customer Email, Address 1, City, State, Zip Code, Insurance Company, Referrer, Property Type
```

## Required Columns

Listed in `MOTHER_BRAIN_REQUIRED_COLUMNS` in `lib/motherBrain.ts`.

- `Name`: job number, the upsert key, and the source of job type and office codes
- `Customer`: customer name in the UI and in `{{Customer Name}}` templates
- `Customer Phone Number`: where texts are sent, and how inbound replies match a job
- `Status`: status-change plans, pulse checks, and the Lost customer guard
- `Link to Project`: link to the Albi job from the inbox and staff emails
- `Created At`: the 2026-01-01 cutoff for plans
- `Inspection Date`, `Estimated Work Start Date`, `File Closed`, `Estimate sent`, `Contract Signed`, `COC/COS Signed`, `Invoiced`, `Work Start`, `Paid`, `Estimated Completion Date`: date-offset plan triggers and template placeholders

## Template Columns

Used only as `{{placeholders}}` in message templates, and listed in the placeholder picker (`components/PlaceholderPicker.tsx`).

- `Project Manager`, `Estimator`, `Sales Person`, `Dispatch/Coordinator`: who the customer works with
- `Customer Email`, `Address 1`, `City`, `State`, `Zip Code`: customer and property details
- `Insurance Company`, `Referrer`, `Property Type`: job context

## Left Out On Purpose

Financial and claim fields should never appear in a customer text, so they aren't requested: `Estimated Revenue`, `Total Payment Amount`, `Total Actual Expenses`, `Accrual Revenue`, `Total Invoice Amount`, `Deductible`, `Insurance Claim Number`, `Lost Reason`. The ID columns (`Albi Project ID`, `Albi Project Identifier`) and `Company`, `Referral Source` aren't needed either.

To use another column in templates, add it to this app's API key and to this file. No code change is needed, though adding it to the placeholder picker helps people find it.
