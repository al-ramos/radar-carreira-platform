/** Chave estável para localizar o mesmo empregador apesar de pequenas variações de escrita. */
export function companyContactKey(company: string) {
  return company
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
