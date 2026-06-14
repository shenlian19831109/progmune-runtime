
    function queryUsers() {
        const db = db_connect("localhost");
        const rows = db_query(db, "SELECT * FROM users");
        db_disconnect(db);
    }
    function insertLog(msg) {
        const db = db_connect("localhost");
        db_insert(db, "logs", msg);
        db_disconnect(db);
    }
  