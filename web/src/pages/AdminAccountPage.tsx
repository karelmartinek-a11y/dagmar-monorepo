import { AccountMethods } from "../components/AccountMethods";

export function AdminAccountPage() {
  return <div className="page">
    <header className="page-heading"><div><p>Vlastní administrátorský účet</p><h1>Zabezpečení účtu</h1><p>Externí metody nemění interní heslo ani administrátorská oprávnění.</p></div></header>
    <AccountMethods portal="admin" />
  </div>;
}
