
    function queryUsers() {
        const db = connect_db("localhost");
        const rows = query_db(db, "SELECT * FROM users");
        disconnect_db(db);
        return rows;
    }
    function insertLog(msg) {
        const db = connect_db("localhost");
        insert_db(db, "logs", msg);
        disconnect_db(db);
    }
  