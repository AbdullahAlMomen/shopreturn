import { signIn } from "./client.mjs";

const USERS = [
  ["customerA", process.env.SHOPRETURN_CUSTOMER_A_EMAIL, process.env.SHOPRETURN_CUSTOMER_A_PASSWORD],
  ["customerB", process.env.SHOPRETURN_CUSTOMER_B_EMAIL, process.env.SHOPRETURN_CUSTOMER_B_PASSWORD],
  ["ops", process.env.SHOPRETURN_OPS_EMAIL, process.env.SHOPRETURN_OPS_PASSWORD],
  ["manager", process.env.SHOPRETURN_MANAGER_EMAIL, process.env.SHOPRETURN_MANAGER_PASSWORD]
];

let failed = 0;
for (const [label, email, password] of USERS) {
  try {
    const { token } = await signIn(email, password);
    console.log(`ok    ${label.padEnd(10)} token length ${token.length}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${label.padEnd(10)} ${error.message}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
