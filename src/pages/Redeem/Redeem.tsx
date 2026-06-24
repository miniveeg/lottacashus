import { Navigate } from "react-router-dom";
import { Seo } from "../../components/Seo/Seo";

/**
 * /redeem now redirects to /withdraw.
 *
 * Audit finding (Wallet agent #11): Redeem was a duplicate of Withdraw — both
 * called the same `request_sc_redemption` RPC but with contradictory minimums
 * (10 SC on Withdraw vs 100 SC on Redeem) and different SLAs, confusing users
 * and splitting history across two pages. They are now a single unified
 * cashout page at /withdraw.
 *
 * The route is kept (rather than removed) so existing Footer/Sidebar/search
 * links and user bookmarks still resolve. The redirect uses `replace` so it
 * doesn't create a back-button trap.
 */
export default function Redeem() {
  return (
    <>
      <Seo title="Redeem" path="/redeem" noindex />
      <Navigate to="/withdraw" replace />
    </>
  );
}
